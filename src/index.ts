import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';
import { OneCLI } from '@onecli-sh/sdk';

import {
  ASSISTANT_NAME,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_URL,
  CALENDAR_REFRESH_INTERVAL_MS,
  DATA_DIR,
  MINIAPP_PORT,
  MINIAPP_ALLOWED_USER_IDS,
  IDLE_TIMEOUT,
  LIVE_MESSAGE_BACKOFF_MS,
  LIVE_MESSAGE_INTERVAL_MS,
  MAX_MESSAGES_PER_PROMPT,
  LOGS_DIR,
  ONECLI_URL,
  POLL_INTERVAL,
  SCHEDULE_SYNC_INTERVAL,
  SCRIPTS_DIR,
  WEATHER_LATITUDE,
  WEATHER_LONGITUDE,
  TELEGRAM_MAX_LENGTH,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import './channels/index.js';
import {
  ChannelOpts,
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  ProgressEvent,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { LiveMessage } from './live-message.js';
import {
  extractBareLinks,
  linksFilePath,
  migrateLinksFile,
} from './link-capture.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getLastBotMessageTimestamp,
  getTasksForGroup,
  getTaskById,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
  createTask,
  updateTask,
  deleteTask,
  addLink,
  getLinks,
  updateLink,
  deleteLink,
  countLinks,
  searchMessages,
  getLastSenderName,
} from './db.js';
import {
  eventsFilePath,
  parseEvents,
  syncCalendarEvents,
} from './calendar-sync.js';
import { planSummaries } from './summaries.js';
import { WeatherCache } from './weather.js';
import {
  scheduleFilePath,
  syncScheduleFile,
} from './schedule-sync.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { ChannelType } from './text-styles.js';
import {
  restoreRemoteControl,
  startRemoteControl,
  stopRemoteControl,
} from './remote-control.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import { extractSessionCommand, handleSessionCommand, isSessionCommandAllowed } from './session-commands.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Heartbeat } from './heartbeat.js';
import { applyReminderAction, reminderButtons } from './reminder-actions.js';
import { ReplyIndex, applyReplyAction, replyButtons } from './reply-actions.js';
import {
  applyRuleAction,
  learnButton,
  proposalButtons,
} from './rule-actions.js';
import { addRule, readRules, rulesFilePath, rulesPromptBlock } from './rules.js';
import { TokenWatchdog } from './token-watchdog.js';
import { transcriptionProblems } from './transcription.js';
import { CalendarRefresher } from './calendar-refresh.js';
import { startMiniAppServer } from './miniapp/server.js';
import { parseAllowedUserIds } from './miniapp/auth.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();

/**
 * Recent replies, so a "remind me later" button can recover the text it was
 * attached to — a 64-byte callback payload cannot carry it.
 */
const replyIndex = new ReplyIndex();

/**
 * Tasks the agent created since the last reply, per chat, and the tasks each
 * delivered reply is responsible for. Together they let a reply that announces
 * new reminders offer to take them back — speech capture mishears, and undoing
 * should cost one tap.
 */
const pendingCreatedTasks = new Map<string, string[]>();
const repliedTasks = new ReplyIndex();

/**
 * Chats whose next reply is a proposed rule rather than an answer. It carries
 * ✅/🗑 instead of the usual buttons — a proposal is not something to be
 * reminded about or filed as a note.
 */
const awaitingProposal = new Set<string>();

/** Weather for the morning rundown; null when coordinates are not configured. */
const weather =
  WEATHER_LATITUDE && WEATHER_LONGITUDE
    ? new WeatherCache({
        latitude: Number(WEATHER_LATITUDE),
        longitude: Number(WEATHER_LONGITUDE),
        timeZone: TIMEZONE,
      })
    : null;

const onecli = new OneCLI({ url: ONECLI_URL });

function ensureOneCLIAgent(jid: string, group: RegisteredGroup): void {
  if (group.isMain) return;
  const identifier = group.folder.toLowerCase().replace(/_/g, '-');
  onecli.ensureAgent({ name: group.name, identifier }).then(
    (res) => {
      logger.info(
        { jid, identifier, created: res.created },
        'OneCLI agent ensured',
      );
    },
    (err) => {
      logger.debug(
        { jid, identifier, err: String(err) },
        'OneCLI agent ensure skipped',
      );
    },
  );
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

/**
 * Return the message cursor for a group, recovering from the last bot reply
 * if lastAgentTimestamp is missing (new group, corrupted state, restart).
 */
function getOrRecoverCursor(chatJid: string): string {
  const existing = lastAgentTimestamp[chatJid];
  if (existing) return existing;

  const botTs = getLastBotMessageTimestamp(chatJid, ASSISTANT_NAME);
  if (botTs) {
    logger.info(
      { chatJid, recoveredFrom: botTs },
      'Recovered message cursor from last bot reply',
    );
    lastAgentTimestamp[chatJid] = botTs;
    saveState();
    return botTs;
  }
  return '';
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Copy CLAUDE.md template into the new group folder so agents have
  // identity and instructions from the first run.  (Fixes #1391)
  const groupMdFile = path.join(groupDir, 'CLAUDE.md');
  if (!fs.existsSync(groupMdFile)) {
    const templateFile = path.join(
      GROUPS_DIR,
      group.isMain ? 'main' : 'global',
      'CLAUDE.md',
    );
    if (fs.existsSync(templateFile)) {
      let content = fs.readFileSync(templateFile, 'utf-8');
      if (ASSISTANT_NAME !== 'Andy') {
        content = content.replace(/^# Andy$/m, `# ${ASSISTANT_NAME}`);
        content = content.replace(/You are Andy/g, `You are ${ASSISTANT_NAME}`);
      }
      fs.writeFileSync(groupMdFile, content);
      logger.info({ folder: group.folder }, 'Created CLAUDE.md from template');
    }
  }

  // Ensure a corresponding OneCLI agent exists (best-effort, non-blocking)
  ensureOneCLIAgent(jid, group);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Message IDs currently showing the 👀 "processing" reaction, per chat.
 *
 * A run can mark more than one message: follow-ups sent while the container is
 * still working get piped in and marked too (see the piping path in
 * startMessageLoop). Tracking them per chat is what lets the final verdict
 * clear *every* one of them — marking only the batch's last message left the
 * piped ones stuck on 👀 forever.
 */
const pendingReactions = new Map<string, Set<string>>();

/** Mark a message as being processed, remembering it for later finalization. */
export function markProcessing(
  channel: Channel | undefined,
  chatJid: string,
  messageId: string,
): void {
  let ids = pendingReactions.get(chatJid);
  if (!ids) {
    ids = new Set();
    pendingReactions.set(chatJid, ids);
  }
  ids.add(messageId);
  channel?.setReaction?.(chatJid, messageId, '👀')?.catch(() => {});
}

/**
 * Replace every pending 👀 in this chat with the run's verdict.
 *
 * Must run exactly once per run, on every exit path including throws —
 * otherwise the eyes stay up and the user cannot tell a working bot from a
 * dead one.
 */
export async function finalizeReactions(
  channel: Channel | undefined,
  chatJid: string,
  emoji: '👍' | '💔',
): Promise<void> {
  const ids = pendingReactions.get(chatJid);
  pendingReactions.delete(chatJid);
  if (!ids || !channel?.setReaction) return;
  await Promise.all(
    [...ids].map((id) =>
      channel.setReaction!(chatJid, id, emoji).catch(() => {}),
    ),
  );
}

/**
 * Record something the bot said, so the conversation is whole.
 *
 * Only the user's half was stored, which made the history unsearchable: you
 * could find what you asked but never what you were told. The fetch that builds
 * prompts already excludes `is_bot_message`, so recording replies cannot feed
 * them back to the agent.
 */
function recordBotMessage(
  chatJid: string,
  text: string,
  messageId?: string | null,
): void {
  if (!text.trim()) return;
  try {
    storeMessage({
      id: messageId || `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chat_jid: chatJid,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: true,
    });
  } catch (err) {
    // History is a convenience; never fail a reply over it.
    logger.debug({ chatJid, err }, 'Failed to record bot message');
  }
}

/**
 * Put text into the chat as though the user had typed it.
 *
 * Used by the Mini App's compose box and by the 📝 button. Stored exactly as an
 * arriving message so the ordinary poll loop picks it up — which means the
 * agent's reply lands in the chat, with its buttons and history, rather than
 * needing a second delivery path.
 */
function injectUserMessage(chatJid: string, text: string): void {
  storeMessage({
    id: `inject-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: chatJid,
    sender: 'conclaw',
    sender_name: getLastSenderName(chatJid) || 'User',
    content: text,
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const missedMessages = getMessagesSince(
    chatJid,
    getOrRecoverCursor(chatJid),
    ASSISTANT_NAME,
    MAX_MESSAGES_PER_PROMPT,
  );

  if (missedMessages.length === 0) return true;

  // --- Session command interception (before trigger check) ---
  const cmdResult = await handleSessionCommand({
    missedMessages,
    isMainGroup,
    groupName: group.name,
    triggerPattern: getTriggerPattern(group.trigger),
    timezone: TIMEZONE,
    deps: {
      sendMessage: (text) => channel.sendMessage(chatJid, text),
      setTyping: (typing) => channel.setTyping?.(chatJid, typing) ?? Promise.resolve(),
      runAgent: (prompt, onOutput) => runAgent(group, prompt, chatJid, onOutput),
      closeStdin: () => queue.closeStdin(chatJid),
      advanceCursor: (ts) => { lastAgentTimestamp[chatJid] = ts; saveState(); },
      formatMessages,
      canSenderInteract: (msg) => {
        const hasTrigger = getTriggerPattern(group.trigger).test(msg.content.trim());
        const reqTrigger = !isMainGroup && group.requiresTrigger !== false;
        return isMainGroup || !reqTrigger || (hasTrigger && (
          msg.is_from_me ||
          isTriggerAllowed(chatJid, msg.sender, loadSenderAllowlist())
        ));
      },
    },
  });
  if (cmdResult.handled) return cmdResult.success;
  // --- End session command interception ---

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const triggerPattern = getTriggerPattern(group.trigger);
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        triggerPattern.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) {
      return true;
    }
  }

  // Messages that are only links are collected rather than answered. Replying
  // to each interrupts, costs a container, and is read even less than the link
  // would have been; the evening digest reports them once. A link sent *with* a
  // question stays a question and falls through to the agent.
  const captured: string[] = [];
  const forAgent = missedMessages.filter((m) => {
    const links = extractBareLinks(m.content);
    if (!links) return true;
    captured.push(...links);
    channel.setReaction?.(chatJid, m.id, '🔖')?.catch(() => {});
    return false;
  });

  if (captured.length > 0) {
    try {
      const at = new Date().toISOString();
      for (const url of captured) addLink(group.folder, url, at);
      logger.info({ group: group.name, count: captured.length }, 'Links captured');
    } catch (err) {
      logger.error({ group: group.name, err }, 'Failed to capture links');
    }
  }

  if (forAgent.length === 0) {
    // Nothing but links. The cursor is advanced here rather than below, because
    // the normal path has not run yet — without this the same links are
    // re-fetched on the next poll and captured again, forever.
    lastAgentTimestamp[chatJid] =
      missedMessages[missedMessages.length - 1].timestamp;
    saveState();
    return true;
  }

  // Rules learned from past mistakes ride in the prompt rather than in
  // CLAUDE.md: that file is read when a session starts, so a rule added
  // mid-session would not apply until the next one — exactly when it is least
  // likely to be remembered and most likely to be needed.
  const rulesFile = rulesFilePath(resolveGroupFolderPath(group.folder));
  const prompt =
    rulesPromptBlock(readRules(rulesFile)) + formatMessages(forAgent, TIMEZONE);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  // React to the last user message to signal processing status
  // The last message the agent is actually answering — not a link captured
  // after it, which already carries its own 🔖.
  const lastMsg = forAgent[forAgent.length - 1];
  markProcessing(channel, chatJid, lastMsg.id);

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  // Live message: only if the channel can edit. Elsewhere it stays inert and
  // results are delivered as ordinary messages, exactly as before.
  const newLive = () =>
    new LiveMessage({
      send: (text) =>
        channel.sendUpdatableMessage?.(chatJid, text) ?? Promise.resolve(null),
      edit: (id, text) =>
        channel.editMessage?.(chatJid, id, text) ?? Promise.resolve(),
      intervalMs: LIVE_MESSAGE_INTERVAL_MS,
      backoffMs: LIVE_MESSAGE_BACKOFF_MS,
    });
  // Each answer consumes its live message; the next turn of the same container
  // (a piped follow-up, or another agent-teams result) gets a fresh one.
  let live = newLive();
  // Show the spinner immediately — container start alone is several seconds.
  live.start();

  const deliver = async (text: string): Promise<void> => {
    const id = await live.finish();
    live = newLive();
    if (!id || !channel.editMessage) {
      await channel.sendMessage(chatJid, text);
      recordBotMessage(chatJid, text);
      return;
    }
    try {
      const shown = text.slice(0, TELEGRAM_MAX_LENGTH);
      const created = pendingCreatedTasks.get(chatJid) ?? [];
      pendingCreatedTasks.delete(chatJid);
      const isProposal = awaitingProposal.delete(chatJid);
      await channel.editMessage(chatJid, id, shown, {
        markdown: true,
        buttons: isProposal
          ? proposalButtons()
          : [...replyButtons(created.length > 0), learnButton()],
      });
      replyIndex.remember(chatJid, id, shown);
      recordBotMessage(chatJid, shown, id);
      if (created.length > 0) repliedTasks.remember(chatJid, id, created.join(','));
      if (text.length > TELEGRAM_MAX_LENGTH) {
        await channel.sendMessage(chatJid, text.slice(TELEGRAM_MAX_LENGTH));
      }
    } catch (err) {
      // Editing failed (message deleted, too old, …) — the answer still has to
      // reach the user, so fall back to a fresh message.
      logger.debug({ chatJid, err }, 'Live message edit failed, sending normally');
      await channel.sendMessage(chatJid, text);
    }
  };

  let output: 'success' | 'error';
  try {
    output = await runAgent(group, prompt, chatJid, async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.length} chars`);
        if (text) {
          await deliver(text);
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      // Settle per result, not in the finally below. The container outlives the
      // answer by up to IDLE_TIMEOUT waiting for follow-ups, so anything tied to
      // the run's end shows stale state — "typing…" and 👀 both lingering for
      // half an hour after the reply already landed. The piping path re-arms
      // both when new input arrives.
      if (result.status === 'success') {
        await channel.setTyping?.(chatJid, false).catch(() => {});
        await finalizeReactions(channel, chatJid, '👍');
        queue.notifyIdle(chatJid);
      }

      if (result.status === 'error') {
        hadError = true;
        await channel.setTyping?.(chatJid, false).catch(() => {});
        await finalizeReactions(channel, chatJid, '💔');
      }
    }, (event) => live.onProgress(event));
  } catch (err) {
    // A throw here used to skip the reaction cleanup below, stranding 👀.
    logger.error({ group: group.name, err }, 'Agent run threw');
    output = 'error';
  } finally {
    // Safety net only — the common path already settled per result above. This
    // catches runs that ended without ever producing one (crash, timeout, kill),
    // and is a no-op when nothing is left pending.
    await channel.setTyping?.(chatJid, false).catch(() => {});
    if (idleTimer) clearTimeout(idleTimer);

    // If the run ended without ever delivering a result, the live message is
    // still sitting there mid-spinner. Leave a readable trace instead of a
    // frozen "Thinking…".
    const orphan = await live.finish();
    if (orphan && channel.editMessage) {
      const streamed = live.streamedText.trim();
      await channel
        .editMessage(chatJid, orphan, streamed || '⚠️ No response', {
          markdown: false,
        })
        .catch(() => {});
      if (streamed) outputSentToUser = true;
    }

    await finalizeReactions(
      channel,
      chatJid,
      hadError || output! === 'error' ? '💔' : '👍',
    );
  }

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onProgress?: (event: ProgressEvent) => void,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      script: t.script || undefined,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
      onProgress,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`ConClaw running (default trigger: ${DEFAULT_TRIGGER})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;

          // --- Session command interception (message loop) ---
          // Scan ALL messages in the batch for a session command.
          const loopCmdMsg = groupMessages.find(
            (m) => extractSessionCommand(m.content, getTriggerPattern(group.trigger)) !== null,
          );

          if (loopCmdMsg) {
            // Only close active container if the sender is authorized — otherwise an
            // untrusted user could kill in-flight work by sending /compact (DoS).
            // closeStdin no-ops internally when no container is active.
            if (isSessionCommandAllowed(isMainGroup, loopCmdMsg.is_from_me === true)) {
              queue.closeStdin(chatJid);
            }
            // Enqueue so processGroupMessages handles auth + cursor advancement.
            // Don't pipe via IPC — slash commands need a fresh container with
            // string prompt (not MessageStream) for SDK recognition.
            queue.enqueueMessageCheck(chatJid);
            continue;
          }
          // --- End session command interception ---

          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const triggerPattern = getTriggerPattern(group.trigger);
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                triggerPattern.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            getOrRecoverCursor(chatJid),
            ASSISTANT_NAME,
            MAX_MESSAGES_PER_PROMPT,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // React to the last message to signal it was received. Registering
            // it means the in-flight run's finalizer will clear it too — before
            // this, a piped message kept 👀 forever.
            const pipedLastMsg = messagesToSend[messagesToSend.length - 1];
            markProcessing(channel, chatJid, pipedLastMsg.id);
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const pending = getMessagesSince(
      chatJid,
      getOrRecoverCursor(chatJid),
      ASSISTANT_NAME,
      MAX_MESSAGES_PER_PROMPT,
    );
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Ensure OneCLI agents exist for all registered groups.
  // Recovers from missed creates (e.g. OneCLI was down at registration time).
  for (const [jid, group] of Object.entries(registeredGroups)) {
    ensureOneCLIAgent(jid, group);
  }

  restoreRemoteControl();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle /remote-control and /remote-control-end commands
  async function handleRemoteControl(
    command: string,
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      logger.warn(
        { chatJid, sender: msg.sender },
        'Remote control rejected: not main group',
      );
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;

    if (command === '/remote-control') {
      const result = await startRemoteControl(
        msg.sender,
        chatJid,
        process.cwd(),
      );
      if (result.ok) {
        await channel.sendMessage(chatJid, result.url);
      } else {
        await channel.sendMessage(
          chatJid,
          `Remote Control failed: ${result.error}`,
        );
      }
    } else {
      const result = stopRemoteControl();
      if (result.ok) {
        await channel.sendMessage(chatJid, 'Remote Control session ended.');
      } else {
        await channel.sendMessage(chatJid, result.error);
      }
    }
  }

  // Channel callbacks (shared by all channels)
  const channelOpts: ChannelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      // Remote control commands — intercept before storage
      const trimmed = msg.content.trim();
      if (trimmed === '/remote-control' || trimmed === '/remote-control-end') {
        handleRemoteControl(trimmed, chatJid, msg).catch((err) =>
          logger.error({ err, chatJid }, 'Remote control command error'),
        );
        return;
      }

      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      storeMessage(msg);
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
    onCallbackAction: async (chatJid, messageId, action) => {
      const editText = async (jid: string, id: string, text: string) => {
        const channel = findChannel(channels, jid);
        // Editing also drops the inline keyboard, so a handled message cannot
        // be actioned twice.
        await channel?.editMessage?.(jid, id, text, { markdown: true });
      };

      const group = registeredGroups[chatJid];
      if (group) {
        const ruleResult = await applyRuleAction(chatJid, messageId, action, {
          getText: (jid, id) => replyIndex.get(jid, id),
          sendToAgent: injectUserMessage,
          awaitProposal: (jid) => awaitingProposal.add(jid),
          addRule: (text) =>
            addRule(rulesFilePath(resolveGroupFolderPath(group.folder)), text),
          editMessage: editText,
        });
        if (ruleResult !== null) return ruleResult;

        const replyResult = await applyReplyAction(chatJid, messageId, action, {
          groupFolder: group.folder,
          getText: (jid, id) => replyIndex.get(jid, id),
          createTask,
          deleteTask,
          getCreatedTasks: (jid, id) => {
            const stored = repliedTasks.get(jid, id);
            return stored ? stored.split(',').filter(Boolean) : [];
          },
          editMessage: editText,
          sendToAgent: injectUserMessage,
        });
        if (replyResult !== null) return replyResult;
      }

      const result = await applyReminderAction(chatJid, messageId, action, {
        getTask: getTaskById,
        createTask,
        deleteTask,
        editMessage: async (jid, id, text) => {
          const channel = findChannel(channels, jid);
          // Editing also drops the inline keyboard, so a handled reminder
          // cannot be actioned twice.
          await channel?.editMessage?.(jid, id, text, { markdown: true });
        },
      });
      return result ?? undefined;
    },
  };

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Keep reminder tasks in step with each group's schedule.md. Re-runs on a
  // timer because the file is edited by hand and by the agent, and a stale
  // reminder is invisible until it fires at the wrong time.
  const syncSchedules = () => {
    // Fire and forget: the rundown renders with whatever line is cached, so a
    // slow forecast never delays a sync pass.
    void weather?.refreshIfStale();
    for (const [jid, group] of Object.entries(registeredGroups)) {
      let groupDir: string;
      try {
        groupDir = resolveGroupFolderPath(group.folder);
      } catch {
        continue;
      }
      try {
        syncScheduleFile({
          groupFolder: group.folder,
          chatJid: jid,
          scheduleFile: scheduleFilePath(groupDir),
          getTasks: getTasksForGroup,
          createTask,
          updateTask,
          deleteTask,
          nextRunFor: (cron) => {
            try {
              return CronExpressionParser.parse(cron, { tz: TIMEZONE })
                .next()
                .toISOString();
            } catch {
              return null;
            }
          },
          digestExtra: weather?.line ?? undefined,
        });
      } catch (err) {
        logger.error({ group: group.folder, err }, 'Schedule sync failed');
      }

      try {
        syncCalendarEvents({
          groupFolder: group.folder,
          chatJid: jid,
          eventsFile: eventsFilePath(groupDir),
          timeZone: TIMEZONE,
          getTasks: getTasksForGroup,
          createTask,
          updateTask,
          deleteTask,
        });
      } catch (err) {
        logger.error({ group: group.folder, err }, 'Calendar sync failed');
      }

      // Summaries are re-rendered on every pass so the text that eventually
      // goes out was composed a minute earlier, not whenever the task was made.
      try {
        const eventsFile = eventsFilePath(groupDir);
        if (fs.existsSync(eventsFile)) {
          const events = parseEvents(fs.readFileSync(eventsFile, 'utf-8'));
          const plan = planSummaries(
            group.folder,
            events,
            getTasksForGroup(group.folder),
            { now: Date.now(), timeZone: TIMEZONE },
          );
          for (const item of plan.upsert) {
            const nextRun = (() => {
              try {
                return CronExpressionParser.parse(item.cron, { tz: TIMEZONE })
                  .next()
                  .toISOString();
              } catch {
                return null;
              }
            })();
            if (getTaskById(item.id)) {
              updateTask(item.id, {
                prompt: item.prompt,
                schedule_value: item.cron,
                next_run: nextRun,
              });
            } else {
              createTask({
                id: item.id,
                group_folder: group.folder,
                chat_jid: jid,
                prompt: item.prompt,
                script: null,
                schedule_type: 'cron',
                schedule_value: item.cron,
                context_mode: 'isolated',
                kind: 'notify',
                next_run: nextRun,
                status: 'active',
                created_at: new Date().toISOString(),
              });
            }
          }
          for (const id of plan.remove) deleteTask(id);
        }
      } catch (err) {
        logger.error({ group: group.folder, err }, 'Summary sync failed');
      }
    }
  };
  syncSchedules();
  setInterval(syncSchedules, SCHEDULE_SYNC_INTERVAL).unref?.();

  // Dead-man's switch. Everything else that watches this bot runs inside the
  // pod and dies with it; only an outside observer can tell that apart from a
  // quiet day.
  if (HEARTBEAT_URL) {
    new Heartbeat({
      url: HEARTBEAT_URL,
      intervalMs: HEARTBEAT_INTERVAL_MS,
      isHealthy: () => {
        const connected = channels.filter((c) => c.isConnected());
        if (connected.length === 0) {
          return { ok: false, reason: 'no channel connected' };
        }
        return { ok: true };
      },
    }).start();
  } else {
    logger.debug('HEARTBEAT_URL not set — external heartbeat disabled');
  }

  // Watch the Claude OAuth credential. Lives here rather than as its own
  // process: a separate supervisor would itself need supervising, and if this
  // process is down there is no bot left to keep working.
  new TokenWatchdog({
    logPath: path.join(LOGS_DIR, 'refresh-token.log'),
    scriptPath: path.join(SCRIPTS_DIR, 'refresh-token.sh'),
    notify: async (message) => {
      const mainJid = Object.keys(registeredGroups).find(
        (jid) => registeredGroups[jid].isMain,
      );
      if (!mainJid) return;
      const channel = findChannel(channels, mainJid);
      await channel?.sendMessage(mainJid, message);
    },
  }).start();

  // Refetch the calendar from the host rather than from a container. The
  // gateway authenticates the request either way; a container start bought
  // nothing over one HTTPS call.
  for (const group of Object.values(registeredGroups)) {
    if (!group.isMain) continue;
    new CalendarRefresher({
      scriptPath: path.join(SCRIPTS_DIR, 'refresh-calendar-cache.sh'),
      outputPath: path.join(
        resolveGroupFolderPath(group.folder),
        'calendar_events.json',
      ),
      tmpDir: path.join(DATA_DIR, 'tmp'),
      getGatewayConfig: () => onecli.getContainerConfig(),
      intervalMs: CALENDAR_REFRESH_INTERVAL_MS,
    }).start();
  }

  // Say up front if voice notes cannot be transcribed. The symptom otherwise
  // is the agent receiving a bare `[Voice message]` hours later and guessing
  // at the cause, which it does badly and confidently.
  transcriptionProblems().then(
    (problems) => {
      if (problems.length > 0) {
        logger.warn({ problems }, 'Voice transcription is not fully set up');
      }
    },
    (err) => logger.debug({ err }, 'Transcription check failed'),
  );

  // Links moved from a per-group JSONL file into the database. Runs every
  // start and is a no-op once each group's file has been taken out of the way.
  for (const group of Object.values(registeredGroups)) {
    try {
      const imported = migrateLinksFile(
        linksFilePath(resolveGroupFolderPath(group.folder)),
        (url, at) => addLink(group.folder, url, at),
      );
      if (imported > 0) {
        logger.info(
          { group: group.name, imported },
          'Imported links from links.jsonl',
        );
      }
    } catch (err) {
      logger.error({ group: group.name, err }, 'Failed to import links.jsonl');
    }
  }

  // Telegram Mini App. The only listening socket in the process, so it stays
  // off unless both a port and an allowlist are configured — see startMiniAppServer.
  const mainJid = Object.keys(registeredGroups).find(
    (jid) => registeredGroups[jid].isMain,
  );
  const mainGroupFolder = mainJid ? registeredGroups[mainJid].folder : undefined;
  if (MINIAPP_PORT && mainJid && mainGroupFolder) {
    const refreshLog = path.join(LOGS_DIR, 'refresh-token.log');
    startMiniAppServer({
      port: MINIAPP_PORT,
      botToken: readEnvFile(['TELEGRAM_BOT_TOKEN']).TELEGRAM_BOT_TOKEN || '',
      allowedUserIds: parseAllowedUserIds(MINIAPP_ALLOWED_USER_IDS),
      api: {
        groupFolder: mainGroupFolder,
        chatJid: mainJid,
        getTasks: getTasksForGroup,
        deleteTask,
        getLinks,
        updateLink,
        deleteLink,
        countLinks,
        searchHistory: searchMessages,
        sendToAgent: injectUserMessage,
        lastRefreshAgeMs: () => {
          try {
            return Date.now() - fs.statSync(refreshLog).mtimeMs;
          } catch {
            return null;
          }
        },
      },
    });
  } else if (MINIAPP_PORT) {
    logger.warn('Mini App not started: no main group registered yet');
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText, channel.name as ChannelType);
      if (text) {
        await channel.sendMessage(jid, text);
        recordBotMessage(jid, text);
      }
    },
    sendReminder: async (jid, text, taskId) => {
      const channel = findChannel(channels, jid);
      if (!channel) return;
      // Buttons are best-effort: a channel without them still gets the reminder.
      if (channel.sendMessageWithButtons) {
        const id = await channel.sendMessageWithButtons(
          jid,
          text,
          reminderButtons(taskId),
        );
        if (id) {
          recordBotMessage(jid, text, id);
          return;
        }
      }
      await channel.sendMessage(jid, text);
      recordBotMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const text = formatOutbound(rawText, channel.name as ChannelType);
      if (!text) return Promise.resolve();
      return channel.sendMessage(jid, text).then(() => {
        recordBotMessage(jid, text);
      });
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    onTaskCreated: (chatJid, taskId) => {
      const list = pendingCreatedTasks.get(chatJid) ?? [];
      list.push(taskId);
      pendingCreatedTasks.set(chatJid, list);
    },
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
    onTasksChanged: () => {
      const tasks = getAllTasks();
      const taskRows = tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        script: t.script || undefined,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      }));
      for (const group of Object.values(registeredGroups)) {
        writeTasksSnapshot(group.folder, group.isMain === true, taskRows);
      }
    },
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start ConClaw');
    process.exit(1);
  });
}
