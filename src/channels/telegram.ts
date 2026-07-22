import fs from 'fs';
import https from 'https';
import path from 'path';

import { Api, Bot } from 'grammy';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { logger } from '../logger.js';
import { transcribeAudio } from '../transcription.js';
import { markForwarded } from '../forward-origin.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  MessageButton,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  onCallbackAction?: (
    chatJid: string,
    messageId: string,
    action: string,
  ) => Promise<string | void>;
}

/**
 * How often to re-send the "typing…" chat action. Telegram expires it after
 * roughly 5s, so refresh comfortably inside that window.
 */
const TYPING_REFRESH_MS = 4000;

/**
 * Send a message with Telegram Markdown parse mode, falling back to plain text.
 * Claude's output naturally matches Telegram's Markdown v1 format:
 *   *bold*, _italic_, `code`, ```code blocks```, [links](url)
 */
async function sendTelegramMessage(
  api: { sendMessage: Api['sendMessage'] },
  chatId: string | number,
  text: string,
  options: { message_thread_id?: number } = {},
): Promise<void> {
  try {
    await api.sendMessage(chatId, text, {
      ...options,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    // Fallback: send as plain text if Markdown parsing fails
    logger.debug({ err }, 'Markdown send failed, falling back to plain text');
    await api.sendMessage(chatId, text, options);
  }
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;
  // Telegram clears a chat action after ~5s, so a single sendChatAction shows
  // "typing…" only briefly. Keep one refresh timer per chat while typing is on.
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  /**
   * Download a Telegram file to the group's attachments directory.
   * Returns the container-relative path (e.g. /workspace/group/attachments/photo_123.jpg)
   * or null if the download fails.
   */
  private async downloadFile(
    fileId: string,
    groupFolder: string,
    filename: string,
  ): Promise<string | null> {
    if (!this.bot) return null;

    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) {
        logger.warn({ fileId }, 'Telegram getFile returned no file_path');
        return null;
      }

      const groupDir = resolveGroupFolderPath(groupFolder);
      const attachDir = path.join(groupDir, 'attachments');
      fs.mkdirSync(attachDir, { recursive: true });

      // Sanitize filename and add extension from Telegram's file_path if missing
      const tgExt = path.extname(file.file_path);
      const localExt = path.extname(filename);
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const finalName = localExt ? safeName : `${safeName}${tgExt}`;
      const destPath = path.join(attachDir, finalName);

      const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
      const resp = await fetch(fileUrl);
      if (!resp.ok) {
        logger.warn({ fileId, status: resp.status }, 'Telegram file download failed');
        return null;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(destPath, buffer);

      logger.info({ fileId, dest: destPath }, 'Telegram file downloaded');
      return `/workspace/group/attachments/${finalName}`;
    } catch (err) {
      logger.error({ fileId, err }, 'Failed to download Telegram file');
      return null;
    }
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken, {
      client: {
        baseFetchConfig: { agent: https.globalAgent, compress: true },
      },
    });

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    // Telegram bot commands handled above — skip them in the general handler
    // so they don't also get stored as messages. All other /commands flow through.
    const TELEGRAM_BOT_COMMANDS = new Set(['chatid', 'ping']);

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) {
        const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0].toLowerCase();
        if (TELEGRAM_BOT_COMMANDS.has(cmd)) return;
      }

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();
      const threadId = ctx.message.message_thread_id;

      const replyTo = ctx.message.reply_to_message;
      const replyToMessageId = replyTo?.message_id?.toString();
      const replyToContent = replyTo?.text || replyTo?.caption;
      const replyToSenderName = replyTo
        ? replyTo.from?.first_name ||
          replyTo.from?.username ||
          replyTo.from?.id?.toString() ||
          'Unknown'
        : undefined;

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
      // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Store chat metadata for discovery
      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'telegram',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content: markForwarded(content, ctx.message.forward_origin),
        timestamp,
        is_from_me: false,
        thread_id: threadId ? threadId.toString() : undefined,
        reply_to_message_id: replyToMessageId,
        reply_to_message_content: replyToContent,
        reply_to_sender_name: replyToSenderName,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages: download files when possible, fall back to placeholders.
    const storeMedia = (
      ctx: any,
      placeholder: string,
      opts?: { fileId?: string; filename?: string; transcribe?: boolean },
    ) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        undefined,
        'telegram',
        isGroup,
      );

      const deliver = (content: string) => {
        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content: markForwarded(content, ctx.message.forward_origin),
          timestamp,
          is_from_me: false,
        });
      };

      // If we have a file_id, attempt to download; deliver asynchronously
      if (opts?.fileId) {
        const msgId = ctx.message.message_id.toString();
        const filename =
          opts.filename ||
          `${placeholder.replace(/[\[\] ]/g, '').toLowerCase()}_${msgId}`;
        this.downloadFile(opts.fileId, group.folder, filename).then(
          async (filePath) => {
            if (!filePath) {
              deliver(`${placeholder}${caption}`);
              return;
            }
            if (!opts.transcribe) {
              deliver(`${placeholder} (${filePath})${caption}`);
              return;
            }

            const localPath = path.join(
              resolveGroupFolderPath(group.folder),
              'attachments',
              path.basename(filePath),
            );
            const outcome = await transcribeAudio(localPath);
            if (outcome.ok) {
              // Named as a recording rather than a voice note: the `voice-notes`
              // skill turns a spoken note into reminders, which is the wrong
              // thing to do with an hour of meeting.
              deliver(
                `[Recording transcription: ${filename}]\n${outcome.text}${caption}`,
              );
            } else if (outcome.reason === 'too-long') {
              const minutes = Math.round(outcome.seconds / 60);
              deliver(
                `${placeholder} (${filePath}) — запись на ${minutes} мин, слишком длинная для расшифровки${caption}`,
              );
            } else {
              deliver(`${placeholder} (${filePath})${caption}`);
            }
          },
        );
        return;
      }

      deliver(`${placeholder}${caption}`);
    };

    this.bot.on('message:photo', (ctx) => {
      // Telegram sends multiple sizes; last is largest
      const photos = ctx.message.photo;
      const largest = photos?.[photos.length - 1];
      storeMedia(ctx, '[Photo]', {
        fileId: largest?.file_id,
        filename: `photo_${ctx.message.message_id}`,
      });
    });
    this.bot.on('message:video', (ctx) => {
      storeMedia(ctx, '[Video]', {
        fileId: ctx.message.video?.file_id,
        filename: `video_${ctx.message.message_id}`,
      });
    });
    this.bot.on('message:voice', (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const fileId = ctx.message.voice?.file_id;
      if (!fileId) {
        storeMedia(ctx, '[Voice message]');
        return;
      }

      const filename = `voice_${ctx.message.message_id}`;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';
      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        undefined,
        'telegram',
        isGroup,
      );

      this.downloadFile(fileId, group.folder, filename).then(
        async (filePath) => {
          let content: string;
          if (filePath) {
            // Resolve the actual filesystem path for transcription
            const groupDir = resolveGroupFolderPath(group.folder);
            const localPath = path.join(
              groupDir,
              'attachments',
              path.basename(filePath),
            );
            const outcome = await transcribeAudio(localPath);
            if (outcome.ok) {
              content = `[Voice message transcription: ${outcome.text}]${caption}`;
            } else if (outcome.reason === 'too-long') {
              const minutes = Math.round(outcome.seconds / 60);
              content = `[Voice message] (${filePath}) — запись на ${minutes} мин, слишком длинная для расшифровки${caption}`;
            } else {
              content = `[Voice message] (${filePath})${caption}`;
            }
          } else {
            content = `[Voice message]${caption}`;
          }

          this.opts.onMessage(chatJid, {
            id: ctx.message.message_id.toString(),
            chat_jid: chatJid,
            sender: ctx.from?.id?.toString() || '',
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: false,
          });

          logger.info(
            { chatJid, sender: senderName },
            'Telegram voice message stored',
          );
        },
      );
    });
    // A sent audio file is usually a recording of something — a meeting, a
    // lecture, a call — so it gets transcribed like a voice note. Unlike a
    // voice note it can be an hour long, and transcription runs at roughly
    // real time, so anything past a couple of minutes gets an acknowledgement
    // first: silence for half an hour is indistinguishable from a broken bot.
    this.bot.on('message:audio', (ctx) => {
      const name =
        ctx.message.audio?.file_name || `audio_${ctx.message.message_id}`;
      const seconds = ctx.message.audio?.duration ?? 0;
      if (seconds > 120) {
        const minutes = Math.round(seconds / 60);
        void this.sendMessage(
          `tg:${ctx.chat.id}`,
          `🎧 Расшифровываю запись на ${minutes} мин — это займёт примерно столько же.`,
        ).catch(() => {});
      }
      storeMedia(ctx, '[Audio]', {
        fileId: ctx.message.audio?.file_id,
        filename: name,
        transcribe: true,
      });
    });
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeMedia(ctx, `[Document: ${name}]`, {
        fileId: ctx.message.document?.file_id,
        filename: name,
      });
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeMedia(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeMedia(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeMedia(ctx, '[Contact]'));

    this.bot.on('callback_query:data', async (ctx) => {
      const chatId = ctx.callbackQuery.message?.chat.id;
      const messageId = ctx.callbackQuery.message?.message_id;
      const action = ctx.callbackQuery.data;

      // Telegram spins the button until answerCallbackQuery lands, so the
      // handler must stay fast — it is a local DB write plus one edit. Answering
      // after it, rather than before, is what lets the toast report the outcome.
      let toast: string | void = undefined;
      try {
        if (chatId != null && messageId != null && this.opts.onCallbackAction) {
          toast = await this.opts.onCallbackAction(
            `tg:${chatId}`,
            String(messageId),
            action,
          );
        }
      } catch (err) {
        logger.error({ action, err }, 'Callback action handler failed');
      }
      await ctx
        .answerCallbackQuery(toast ? { text: toast } : undefined)
        .catch(() => {});
    });

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(
    jid: string,
    text: string,
    threadId?: string,
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');
      const options = threadId
        ? { message_thread_id: parseInt(threadId, 10) }
        : {};

      // Telegram has a 4096 character limit per message — split if needed
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await sendTelegramMessage(this.bot.api, numericId, text, options);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await sendTelegramMessage(
            this.bot.api,
            numericId,
            text.slice(i, i + MAX_LENGTH),
            options,
          );
        }
      }
      logger.info(
        { jid, length: text.length, threadId },
        'Telegram message sent',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    this.clearAllTyping();
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot) return;

    const existing = this.typingTimers.get(jid);
    if (existing) {
      clearInterval(existing);
      this.typingTimers.delete(jid);
    }
    if (!isTyping) return;

    const numericId = jid.replace(/^tg:/, '');
    const send = async () => {
      try {
        await this.bot!.api.sendChatAction(numericId, 'typing');
      } catch (err) {
        logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
      }
    };

    await send();
    // Refresh before the ~5s expiry so the indicator stays up for the whole
    // run. unref() so a stuck timer can never hold the process open.
    const timer = setInterval(send, TYPING_REFRESH_MS);
    timer.unref?.();
    this.typingTimers.set(jid, timer);
  }

  /** Stop every typing refresh. Used on disconnect so no timer outlives the bot. */
  private clearAllTyping(): void {
    for (const timer of this.typingTimers.values()) clearInterval(timer);
    this.typingTimers.clear();
  }

  /**
   * Send a message whose id is returned so it can be edited later.
   *
   * Sent as plain text: live content is a partial answer, so its Markdown is
   * routinely mid-token (`**bo`) and would fail to parse. The final answer goes
   * out through the normal formatted path.
   */
  async sendUpdatableMessage(jid: string, text: string): Promise<string | null> {
    if (!this.bot) return null;
    try {
      const numericId = jid.replace(/^tg:/, '');
      const sent = await this.bot.api.sendMessage(numericId, text);
      return String(sent.message_id);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send updatable Telegram message');
      return null;
    }
  }

  async editMessage(
    jid: string,
    messageId: string,
    text: string,
    opts: { markdown?: boolean; buttons?: MessageButton[] } = {},
  ): Promise<void> {
    if (!this.bot) return;
    const msgId = parseInt(messageId, 10);
    if (isNaN(msgId)) return;
    const numericId = jid.replace(/^tg:/, '');
    // Omitting reply_markup on an edit clears the keyboard, which is what an
    // actioned message wants; passing it keeps the buttons live.
    const markup = opts.buttons
      ? {
          reply_markup: {
            inline_keyboard: [
              opts.buttons.map((b) => ({
                text: b.label,
                callback_data: b.action,
              })),
            ],
          },
        }
      : {};

    if (opts.markdown) {
      try {
        await this.bot.api.editMessageText(numericId, msgId, text, {
          parse_mode: 'Markdown',
          ...markup,
        });
        return;
      } catch (err) {
        logger.debug({ jid, err }, 'Markdown edit failed, retrying as plain text');
      }
    }

    try {
      await this.bot.api.editMessageText(numericId, msgId, text, markup);
    } catch (err) {
      // "message is not modified" is expected whenever content did not change
      // between ticks, and a 429 is handled by the caller's backoff. Rethrow so
      // the live-message throttle can tell those cases apart.
      logger.debug({ jid, messageId, err }, 'Failed to edit Telegram message');
      throw err;
    }
  }

  async sendMessageWithButtons(
    jid: string,
    text: string,
    buttons: MessageButton[],
  ): Promise<string | null> {
    if (!this.bot) return null;
    try {
      const numericId = jid.replace(/^tg:/, '');
      const sent = await this.bot.api.sendMessage(numericId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            buttons.map((b) => ({ text: b.label, callback_data: b.action })),
          ],
        },
      });
      return String(sent.message_id);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram message with buttons');
      return null;
    }
  }

  async deleteMessage(jid: string, messageId: string): Promise<void> {
    if (!this.bot) return;
    const msgId = parseInt(messageId, 10);
    if (isNaN(msgId)) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.deleteMessage(numericId, msgId);
    } catch (err) {
      logger.debug({ jid, messageId, err }, 'Failed to delete Telegram message');
    }
  }

  async setReaction(jid: string, messageId: string, emoji: string | null): Promise<void> {
    if (!this.bot) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      const msgId = parseInt(messageId, 10);
      if (isNaN(msgId)) return;
      const reaction: any[] = emoji
        ? [{ type: 'emoji', emoji }]
        : [];
      await this.bot.api.setMessageReaction(numericId, msgId, reaction);
    } catch (err) {
      logger.debug({ jid, messageId, emoji, err }, 'Failed to set Telegram reaction');
    }
  }
}

registerChannel('telegram', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN']);
  const token =
    process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Telegram: TELEGRAM_BOT_TOKEN not set');
    return null;
  }
  return new TelegramChannel(token, opts);
});
