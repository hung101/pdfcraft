# PDFCraft

Free PDF tools that run in your browser: https://pdf-craft.online

Your files are read and written inside the browser tab. Nothing is uploaded, there is no backend, and once the site has loaded the tools keep working with the network off.

This is the complete source of the live site. It is plain HTML, CSS and JavaScript with no build step.

## Tools

| Group | Tools |
|---|---|
| Edit and mark | Edit text, Sign, Watermark, Page numbers |
| Organize pages | Merge, Split, Reorder, Rotate, Delete pages |
| Convert and compress | Compress, PDF to images, Images to PDF |
| Passwords | Protect, Unlock |

## How text editing works

Most browser PDF editors change text by drawing a white box over the old words and writing new ones on top. The old characters stay in the file, and anyone can copy them back out.

The **Edit text** tool removes them instead. A line on the page is often stored as several separate text-showing operators (`Tj`/`TJ`) in the page's content stream, so an edit finds every operator on that baseline inside the clicked span, splices them out, and draws the replacement once. The patched stream is written back to the same object, so the old bytes are not left behind as an orphaned copy.

Delete pages, Split and Reorder rebuild the document with `PDFDocument.create()` and `copyPages()` rather than unlinking pages. pdf-lib writes every indirect object it holds, so a page that is only unlinked is still in the saved file.

The code is in [`pdf-tools.js`](pdf-tools.js): see `listTextRuns`, `groupTextItems` and `replaceTextInPDF`.

### Check it yourself

You don't need to read the code to test this. Edit some text, save the file, then decompress it and search for the old string:

```sh
qpdf --qdf --object-streams=disable edited.pdf plain.pdf
grep -c "old text" plain.pdf
```

Searching the saved file directly isn't enough, because content streams are usually compressed and text is often written as hex.

## Known limits

Each tool page lists its own limits. The main ones:

- **Edit text** draws the replacement in a standard font, because pdf-lib can't add glyphs to the document's own embedded font subset. The rest of the line doesn't reflow, so on many files the result won't match visually. The tool refuses rotated or skewed text, characters outside WinAnsi, and encrypted files. It checks content streams only; it does not touch tagged-PDF `/ActualText` or XMP metadata.
- **Compress** turns each page into a JPEG image, so text is no longer selectable.
- **Sign** places an image on top of the page. A black box drawn with it hides text visually but does not remove it.
- **Unlock** reads RC4 (R2/R3), AES-128 (R4) and AES-256 (R6). It doesn't support R5 or certificate-based encryption.

## Privacy

Your PDFs never leave your device; no code path sends file contents anywhere. The pages do load Google Analytics, so visits are counted. There are no ads. Details are on the [security page](https://pdf-craft.online/security).

## Run it locally

Any static file server works. The site uses clean URLs (`/merge-pdf` rather than `/merge-pdf.html`), so use one that resolves them:

```sh
npx serve .
```

The live site is deployed on Vercel; [`vercel.json`](vercel.json) holds the redirects and security headers.

## Project layout

| Path | What it is |
|---|---|
| `*.html` | One page per tool, plus the home, about, contact, privacy and security pages |
| `how-to/` | Guides |
| `app.js` | Page UI: file handling, previews, tool panels |
| `pdf-tools.js` | PDF operations: merge, split, edit text, watermark and the rest |
| `pdf-crypto.js` | PDF encryption and decryption (RC4, AES-128, AES-256) |
| `sw.js` | Service worker that caches the site for offline use |
| `lib/` | Third-party libraries, self-hosted at pinned versions |

## Third-party code

| Library | Version | Licence |
|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) | 3.4.120 | Apache-2.0 |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT or GPL-3.0 (used under MIT) |
| [Lucide](https://github.com/lucide-icons/lucide) | 1.31.0 | ISC |

Parts of `pdf-crypto.js` are adapted from code by PDFSmaller.com, used under the MIT licence; the attribution is kept in the file.

## Bugs and feedback

Open an issue, or use the [contact page](https://pdf-craft.online/contact). If you find a file where Edit text leaves the old string behind, please attach it if you can. That's the most useful bug report there is.

## Licence

[MIT](LICENSE)
