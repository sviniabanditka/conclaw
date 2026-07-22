#!/usr/bin/env python3
"""Pull the text out of an Office document, using only the standard library.

docx, xlsx and pptx are zip archives of XML. That means they can be read
without pandoc, libreoffice or any pip install — which matters here, because
adding either to the agent image costs hundreds of megabytes and a rebuild for
something a hundred lines of stdlib already does.

What this deliberately does not do is preserve formatting. It recovers text,
structure that carries meaning (paragraphs, rows, slides), and nothing else.
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _text_of(node, tag):
    """Concatenate every <tag> descendant, which is where the characters live."""
    return "".join(n.text or "" for n in node.iter(tag))


def docx(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for para in root.iter(f"{W}p"):
        # A tab is meaningful in a table-ish layout; a break is a line.
        line = "".join(
            "\t" if n.tag == f"{W}tab" else "\n" if n.tag == f"{W}br" else (n.text or "")
            for n in para.iter()
            if n.tag in (f"{W}t", f"{W}tab", f"{W}br")
        )
        out.append(line)
    return "\n".join(out)


def xlsx(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [_text_of(si, f"{S}t") for si in root.iter(f"{S}si")]

        sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        out = []
        for i, name in enumerate(sheets, 1):
            root = ET.fromstring(z.read(name))
            out.append(f"--- лист {i} ---")
            for row in root.iter(f"{S}row"):
                cells = []
                for c in row.iter(f"{S}c"):
                    v = c.find(f"{S}v")
                    raw = v.text if v is not None else ""
                    # t="s" means the value is an index into sharedStrings.
                    if c.get("t") == "s" and raw is not None:
                        idx = int(raw)
                        raw = shared[idx] if idx < len(shared) else ""
                    elif c.get("t") == "inlineStr":
                        raw = _text_of(c, f"{S}t")
                    cells.append(raw or "")
                if any(cells):
                    out.append("\t".join(cells))
        return "\n".join(out)


def pptx(path):
    with zipfile.ZipFile(path) as z:
        slides = sorted(
            (n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=lambda n: int(re.search(r"(\d+)", n).group(1)),
        )
        out = []
        for i, name in enumerate(slides, 1):
            root = ET.fromstring(z.read(name))
            out.append(f"--- слайд {i} ---")
            for para in root.iter(f"{A}p"):
                line = _text_of(para, f"{A}t")
                if line.strip():
                    out.append(line)
        return "\n".join(out)


def plain(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


HANDLERS = {
    "docx": docx,
    "xlsx": xlsx,
    "pptx": pptx,
    "txt": plain,
    "md": plain,
    "csv": plain,
    "tsv": plain,
    "json": plain,
    "xml": plain,
}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: extract.py <file>")
    path = sys.argv[1]
    ext = path.rsplit(".", 1)[-1].lower()

    handler = HANDLERS.get(ext)
    if not handler:
        # Naming the extension beats a generic failure: for pdf and doc there
        # are other routes, and the caller needs to know which one it is on.
        sys.exit(f"unsupported: .{ext}")

    try:
        sys.stdout.write(handler(path))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as err:
        sys.exit(f"could not read .{ext}: {err}")


if __name__ == "__main__":
    main()
