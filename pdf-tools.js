// PDFCraft PDF Manipulation Engine (pdf-tools.js)
// Employs the pdf-lib library in-browser

/**
 * Decodes a base64 data: URL into an ArrayBuffer without touching the network.
 * Overlay images (signature, uploaded image, freehand drawing) are all produced
 * locally as data: URLs, so they must never go through fetch().
 * @param {string} dataUrl - e.g. "data:image/png;base64,iVBOR..."
 * @returns {ArrayBuffer}
 */
function dataUrlToArrayBuffer(dataUrl) {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) {
        throw new Error('Malformed data URL for image overlay');
    }
    const meta = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);

    if (!meta.includes('base64')) {
        throw new Error('Unsupported (non-base64) data URL for image overlay');
    }

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/* ------------------------------------------------------------------------- *
 * Content-stream text scanner
 *
 * Used by the Edit PDF Text tool. This walks a page's raw content stream and
 * records every text-showing operator (Tj / TJ / ' / ") together with the byte
 * span it occupies and the text rendering matrix in effect at that point.
 *
 * Two things to understand before changing any of this:
 *
 * 1. The bytes inside a text operator are NOT characters. They are indices into
 *    whatever font the page selected, so <01020303> may render as "Hello". We
 *    therefore never try to read the text out of the stream — pdf.js already
 *    does that properly via the font's ToUnicode CMap. We only need to locate
 *    the operator so it can be removed, which works regardless of encoding.
 *
 * 2. Matching a pdf.js text item to an operator is done on GEOMETRY, not on
 *    string content, precisely because the operand bytes bear no relation to
 *    the decoded string for a subset font. Both sides compute the same matrix
 *    from the same operands, so positions agree to within rounding.
 * ------------------------------------------------------------------------- */
const PDFTextScanner = (() => {
    const WS = new Uint8Array(256);
    [0, 9, 10, 12, 13, 32].forEach(c => { WS[c] = 1; });
    const DELIM = new Uint8Array(256);
    [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25].forEach(c => { DELIM[c] = 1; });
    const SHOWS = { Tj: 1, TJ: 1, "'": 1, '"': 1 };

    const mul = (a, b) => [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ];

    /**
     * @param {Uint8Array} buf - decoded content stream bytes
     * @returns {Array<{op:string, start:number, end:number, trm:number[],
     *                  fontName:?string, fontSize:number}>}
     */
    function scan(buf) {
        const out = [];
        // Form XObject invocations (name + CTM). Their text is drawn by the
        // XObject's own stream, which this scan does not enter, so callers use
        // these to tell which page areas are not covered by `out`.
        const xobjects = [];
        const n = buf.length;
        let i = 0;
        let opStart = -1;
        let pendingName = null;
        let fontName = null;
        let nums = [];
        const gsStack = [];
        let ctm = [1, 0, 0, 1, 0, 0];
        let tm = [1, 0, 0, 1, 0, 0];
        let tlm = tm.slice();
        let fontSize = 0, hScale = 100, rise = 0, leading = 0;

        const word = (s, e) => {
            let r = '';
            for (let k = s; k < e; k++) r += String.fromCharCode(buf[k]);
            return r;
        };
        const trm = () => mul(mul([fontSize * hScale / 100, 0, 0, fontSize, 0, rise], tm), ctm);

        while (i < n) {
            const c = buf[i];
            if (WS[c]) { i++; continue; }
            if (c === 0x25) { while (i < n && buf[i] !== 10 && buf[i] !== 13) i++; continue; }  // comment
            if (opStart < 0) opStart = i;

            if (c === 0x28) {                       // ( literal string )
                let depth = 0;
                for (; i < n; i++) {
                    const x = buf[i];
                    if (x === 0x5c) { i++; continue; }             // escape: \( \) \\ \ddd
                    if (x === 0x28) depth++;
                    else if (x === 0x29 && --depth === 0) { i++; break; }
                }
                continue;
            }
            if (c === 0x3c) {                       // << dict  or  <hex string>
                if (buf[i + 1] === 0x3c) { i += 2; continue; }
                i++;
                while (i < n && buf[i] !== 0x3e) i++;
                i++;
                continue;
            }
            if (c === 0x3e) { i += (buf[i + 1] === 0x3e ? 2 : 1); continue; }
            if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { i++; continue; }
            if (c === 0x2f) {                       // /Name
                const s = ++i;
                while (i < n && !WS[buf[i]] && !DELIM[buf[i]]) i++;
                pendingName = word(s, i);
                continue;
            }

            const s = i;
            while (i < n && !WS[buf[i]] && !DELIM[buf[i]]) i++;
            const w = word(s, i);

            if (/^[+\-.0-9]/.test(w)) {
                const v = parseFloat(w);
                nums.push(Number.isNaN(v) ? 0 : v);
                continue;
            }

            switch (w) {
                case 'q': gsStack.push(ctm.slice()); break;
                case 'Q': { const g = gsStack.pop(); if (g) ctm = g; break; }
                case 'cm': if (nums.length >= 6) ctm = mul(nums.slice(-6), ctm); break;
                case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
                case 'Tf': if (nums.length) fontSize = nums[nums.length - 1]; fontName = pendingName; break;
                case 'TL': leading = nums[nums.length - 1] ?? leading; break;
                case 'Tz': hScale = nums[nums.length - 1] ?? hScale; break;
                case 'Ts': rise = nums[nums.length - 1] ?? rise; break;
                case 'Tm': if (nums.length >= 6) { tm = nums.slice(-6); tlm = tm.slice(); } break;
                case 'Td':
                case 'TD':
                    if (nums.length >= 2) {
                        if (w === 'TD') leading = -nums[nums.length - 1];
                        tlm = mul([1, 0, 0, 1, nums[nums.length - 2], nums[nums.length - 1]], tlm);
                        tm = tlm.slice();
                    }
                    break;
                case 'T*': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); break;
                case 'Do': if (pendingName) xobjects.push({ name: pendingName, ctm: ctm.slice() }); break;
                case 'BI': {                        // inline image: skip opaquely to EI
                    let k = i;
                    while (k < n - 2 && !(buf[k] === 0x49 && buf[k + 1] === 0x44 && WS[buf[k + 2]])) k++;  // "ID"
                    k += 3;
                    for (; k < n - 1; k++) {
                        if (buf[k] === 0x45 && buf[k + 1] === 0x49 && WS[buf[k - 1]] &&
                            (k + 2 >= n || WS[buf[k + 2]] || DELIM[buf[k + 2]])) { k += 2; break; }
                    }
                    i = k;
                    break;
                }
                default:
                    if (SHOWS[w]) {
                        // ' and " advance to the next line before showing text
                        if (w === "'" || w === '"') {
                            tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
                            tm = tlm.slice();
                        }
                        out.push({ op: w, start: opStart, end: i, trm: trm(), fontName, fontSize });
                    }
            }
            nums = [];
            pendingName = null;
            opStart = -1;
        }
        out.xobjects = xobjects;
        return out;
    }

    return { scan };
})();

const PDFTools = {
    /**
     * Merges multiple PDF files into one.
     * @param {File[]} files - Array of File objects representing PDFs.
     * @returns {Promise<Blob>} - Merged PDF Blob.
     */
    async mergePDFs(files) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const mergedPdf = await PDFLib.PDFDocument.create();

        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const srcPdf = await PDFLib.PDFDocument.load(arrayBuffer);
            const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
            
            copiedPages.forEach((page) => {
                mergedPdf.addPage(page);
            });
        }

        const mergedPdfBytes = await mergedPdf.save();
        return new Blob([mergedPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Splits specific page ranges from a PDF.
     * @param {File} file - Source PDF file.
     * @param {number[]} selectedPages - Array of 1-based page numbers.
     * @returns {Promise<Blob>} - Split PDF Blob.
     */
    async splitPDF(file, selectedPages) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const srcPdf = await PDFLib.PDFDocument.load(arrayBuffer);
        const newPdf = await PDFLib.PDFDocument.create();

        // Convert 1-based page numbers to 0-based indices
        const indices = selectedPages
            .map(p => p - 1)
            .filter(idx => idx >= 0 && idx < srcPdf.getPageCount());

        const copiedPages = await newPdf.copyPages(srcPdf, indices);
        copiedPages.forEach((page) => {
            newPdf.addPage(page);
        });

        const splitPdfBytes = await newPdf.save();
        return new Blob([splitPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Stamps text and signature image overlays onto their respective PDF pages.
     * @param {File} file - Source PDF file.
     * @param {Object} overlays - Page overlays map: { pageNum: [overlayObject, ...] }
     * @returns {Promise<Blob>} - Compiled/Edited PDF Blob.
     */
    async addOverlaysToPDF(file, overlays) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        
        // Load with standard layout updates enabled
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        
        // Embed default Helvetica, Times Roman, and Courier fonts
        const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const timesRomanFont = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        const courierFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Courier);

        // Process page by page
        for (const [pageNumStr, pageOverlays] of Object.entries(overlays)) {
            const pageNum = parseInt(pageNumStr);
            if (pageNum < 1 || pageNum > pages.length || !pageOverlays || pageOverlays.length === 0) {
                continue;
            }

            const page = pages[pageNum - 1];
            const pdfWidth = page.getWidth();
            const pdfHeight = page.getHeight();

            for (const overlay of pageOverlays) {
                // Calculate scale ratio between visual HTML canvas and PDF page points
                const scaleX = pdfWidth / overlay.canvasWidth;
                const scaleY = pdfHeight / overlay.canvasHeight;

                // Scale positions and sizes
                const pdfX = overlay.x * scaleX;
                const pdfW = overlay.width * scaleX;
                const pdfH = overlay.height * scaleY;
                
                // Translate coordinates: PDF (0,0) is bottom-left, DOM (0,0) is top-left
                const pdfY = pdfHeight - (overlay.y * scaleY) - pdfH;

                if (overlay.type === 'text') {
                    // Approximate text baseline height adjustment
                    const pdfFontSize = (overlay.fontSize || 16) * scaleY;
                    
                    // Choose font
                    let activeFont;
                    if (overlay.fontFamily === 'Times Roman') {
                        activeFont = timesRomanFont;
                    } else if (overlay.fontFamily === 'Courier') {
                        activeFont = courierFont;
                    } else {
                        activeFont = helveticaFont;
                    }

                    // Parse color
                    const hex = overlay.color || '#000000';
                    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
                    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
                    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
                    const rgb = result ? {
                        r: parseInt(result[1], 16) / 255,
                        g: parseInt(result[2], 16) / 255,
                        b: parseInt(result[3], 16) / 255
                    } : { r: 0, g: 0, b: 0 };

                    page.drawText(overlay.value, {
                        x: pdfX + 2, // minor padding offset
                        y: pdfY + (pdfH * 0.15), // position above boundary bottom line
                        size: pdfFontSize,
                        font: activeFont,
                        color: PDFLib.rgb(rgb.r, rgb.g, rgb.b)
                    });
                } else if (overlay.type === 'signature' || overlay.type === 'image' || overlay.type === 'drawing') {
                    // Embed image/drawing overlay (PNG or JPG) into the document.
                    // These values are always data: URLs (canvas.toDataURL / FileReader.readAsDataURL),
                    // so decode them in-process. fetch() would be blocked by our CSP connect-src,
                    // and a network API has no business on a fully local code path.
                    const imageBuffer = dataUrlToArrayBuffer(overlay.value);

                    let embeddedImage;
                    try {
                        embeddedImage = await pdfDoc.embedPng(imageBuffer);
                    } catch (err) {
                        try {
                            embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                        } catch (err2) {
                            console.error('Failed to embed image overlay:', err2);
                            continue; // Skip rendering failed image rather than breaking compiler
                        }
                    }

                    page.drawImage(embeddedImage, {
                        x: pdfX,
                        y: pdfY,
                        width: pdfW,
                        height: pdfH
                    });
                } else if (overlay.type === 'redaction') {
                    // Parse fill color
                    const hex = overlay.color || '#000000';
                    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
                    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
                    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
                    const rgb = result ? {
                        r: parseInt(result[1], 16) / 255,
                        g: parseInt(result[2], 16) / 255,
                        b: parseInt(result[3], 16) / 255
                    } : { r: 0, g: 0, b: 0 };

                    page.drawRectangle({
                        x: pdfX,
                        y: pdfY,
                        width: pdfW,
                        height: pdfH,
                        color: PDFLib.rgb(rgb.r, rgb.g, rgb.b)
                    });
                }
            }
        }

        const compiledPdfBytes = await pdfDoc.save();
        return new Blob([compiledPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Rotates specific PDF pages.
     * @param {File} file - Source PDF file.
     * @param {Object} rotationsMap - Object mapping 0-based page index to rotation degrees to add (90, 180, 270).
     * @returns {Promise<Blob>} - Rotated PDF Blob.
     */
    async rotatePDFPages(file, rotationsMap) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        for (const [pageIdxStr, degreesVal] of Object.entries(rotationsMap)) {
            const idx = parseInt(pageIdxStr);
            if (idx >= 0 && idx < pages.length) {
                const page = pages[idx];
                const currentRotation = page.getRotation().angle;
                const newRotation = (currentRotation + degreesVal) % 360;
                page.setRotation(PDFLib.degrees(newRotation));
            }
        }

        const rotatedPdfBytes = await pdfDoc.save();
        return new Blob([rotatedPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Deletes specific page indices from a PDF.
     * @param {File} file - Source PDF file.
     * @param {number[]} deletedIndices - Array of 0-based page indices to delete.
     * @returns {Promise<Blob>} - Compiled PDF Blob.
     */
    async deletePDFPages(file, deletedIndices) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const sourceDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const totalPages = sourceDoc.getPageCount();

        // Build the list of pages to KEEP, then copy those into a brand-new
        // document. Do NOT use pdfDoc.removePage(): it only unlinks the page
        // from the page tree, and pdf-lib's writer serializes every indirect
        // object with no reachability pass — so the deleted page's content
        // stream and image XObjects stay in the output as orphans, and any
        // low-level tool (qpdf, mutool) can still read them out. copyPages()
        // copies only what the kept pages reference, so the removed page's
        // data genuinely is not in the file. Verified with a stream-level audit.
        const drop = new Set(deletedIndices.filter(i => i >= 0 && i < totalPages));
        const keep = [];
        for (let i = 0; i < totalPages; i++) {
            if (!drop.has(i)) keep.push(i);
        }

        if (keep.length === 0) {
            throw new Error('Cannot delete every page — a PDF must keep at least one page.');
        }

        const outDoc = await PDFLib.PDFDocument.create();
        const copied = await outDoc.copyPages(sourceDoc, keep);
        copied.forEach(page => outDoc.addPage(page));

        const compiledPdfBytes = await outDoc.save();
        return new Blob([compiledPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Converts a list of image files into a single PDF.
     * @param {Object[]} imageObjects - Array of objects containing { file, width, height, convertedArrayBuffer, convertedType }
     * @param {Object} options - { pageSize: 'a4'|'letter'|'fit', orientation: 'portrait'|'landscape', margin: 'none'|'small'|'large', alignment: 'center'|'stretch' }
     * @returns {Promise<Blob>} - Generated PDF Blob.
     */
    async convertImagesToPDF(imageObjects, options) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const pdfDoc = await PDFLib.PDFDocument.create();

        // Standard Page Sizes in points (72 points = 1 inch)
        const SIZES = {
            a4: { width: 595.27, height: 841.89 },
            letter: { width: 612.0, height: 792.0 }
        };

        const MARGINS = {
            none: 0,
            small: 20,
            large: 50
        };

        for (const imgObj of imageObjects) {
            const file = imgObj.file;
            let arrayBuffer;
            let isPng = false;

            if (imgObj.convertedArrayBuffer) {
                arrayBuffer = imgObj.convertedArrayBuffer;
                isPng = (imgObj.convertedType === 'image/png');
            } else {
                arrayBuffer = await file.arrayBuffer();
                isPng = (file.type === 'image/png');
            }

            let embeddedImage;
            try {
                if (isPng) {
                    embeddedImage = await pdfDoc.embedPng(arrayBuffer);
                } else {
                    embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
                }
            } catch (err) {
                // Fallback attempt
                try {
                    embeddedImage = await pdfDoc.embedPng(arrayBuffer);
                } catch {
                    try {
                        embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
                    } catch (err2) {
                        throw new Error(`Failed to embed image "${file.name}". Please ensure it is a valid format.`);
                    }
                }
            }

            const imgWidth = embeddedImage.width;
            const imgHeight = embeddedImage.height;

            // Determine page size
            let pageWidth, pageHeight;
            const margin = MARGINS[options.margin || 'none'];

            if (options.pageSize === 'fit') {
                pageWidth = imgWidth + (margin * 2);
                pageHeight = imgHeight + (margin * 2);
            } else {
                const baseSize = SIZES[options.pageSize || 'a4'];
                if (options.orientation === 'landscape') {
                    pageWidth = baseSize.height;
                    pageHeight = baseSize.width;
                } else {
                    pageWidth = baseSize.width;
                    pageHeight = baseSize.height;
                }
            }

            const page = pdfDoc.addPage([pageWidth, pageHeight]);

            // Calculate drawable area dimensions
            const drawWidth = pageWidth - (margin * 2);
            const drawHeight = pageHeight - (margin * 2);

            let finalW, finalH;
            let posX, posY;

            if (options.alignment === 'stretch') {
                finalW = drawWidth;
                finalH = drawHeight;
                posX = margin;
                posY = margin;
            } else {
                // Center and preserve aspect ratio (contain)
                const ratioX = drawWidth / imgWidth;
                const ratioY = drawHeight / imgHeight;
                const scale = Math.min(ratioX, ratioY);

                finalW = imgWidth * scale;
                finalH = imgHeight * scale;

                posX = margin + ((drawWidth - finalW) / 2);
                posY = margin + ((drawHeight - finalH) / 2);
            }

            page.drawImage(embeddedImage, {
                x: posX,
                y: posY,
                width: finalW,
                height: finalH
            });
        }

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    },

    /**
     * Compresses a PDF file by rendering pages to canvases and re-saving as compressed JPEGs.
     * @param {File} file - Source PDF file.
     * @param {number} dpi - Target resolution DPI (e.g. 150).
     * @param {number} quality - JPEG image quality (0.0 to 1.0).
     * @param {Function} progressCallback - Callback updated with (currentPage, totalPages).
     * @returns {Promise<Blob>} - Compressed PDF Blob.
     */
    async compressPDF(file, dpi, quality, progressCallback) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }
        if (!window['pdfjs-dist/build/pdf']) {
            throw new Error('PDF.js is not loaded');
        }

        const PDFLib = window.PDFLib;
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.create();
        
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const srcPdf = await loadingTask.promise;
        const totalPages = srcPdf.numPages;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await srcPdf.getPage(pageNum);
            
            // PDF default size is 72 points per inch (DPI)
            const scale = dpi / 72;
            const viewport = page.getViewport({ scale });
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            await page.render(renderContext).promise;
            
            const jpegBlob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', quality);
            });
            
            const imgBuffer = await jpegBlob.arrayBuffer();
            const embeddedImage = await pdfDoc.embedJpg(imgBuffer);
            
            // Create matching page dimensions
            const origViewport = page.getViewport({ scale: 1.0 });
            const pdfPage = pdfDoc.addPage([origViewport.width, origViewport.height]);
            
            pdfPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: origViewport.width,
                height: origViewport.height
            });
            
            if (progressCallback) {
                progressCallback(pageNum, totalPages);
            }
        }
        
        const compressedPdfBytes = await pdfDoc.save();
        return new Blob([compressedPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Reorders pages of a PDF based on an array of 0-based page indices.
     * @param {File} file - Source PDF file.
     * @param {Array<number>} pageIndices - Array of 0-based page indices representing the new order.
     * @returns {Promise<Blob>} - Reordered PDF Blob.
     */
    async reorderPDF(file, pageIndices) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        
        const srcDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const destDoc = await PDFLib.PDFDocument.create();
        
        // Copy pages one by one in the target order
        for (const index of pageIndices) {
            const [copiedPage] = await destDoc.copyPages(srcDoc, [index]);
            destDoc.addPage(copiedPage);
        }
        
        const reorderedPdfBytes = await destDoc.save();
        return new Blob([reorderedPdfBytes], { type: 'application/pdf' });
    },

    /**
     * Converts a PDF file into individual image pages and returns a ZIP blob.
     * @param {File} file - Source PDF file.
     * @param {Object} options - { format: 'image/jpeg'|'image/png', dpi: number, quality: number }
     * @param {Function} progressCallback - Callback updated with (currentPage, totalPages).
     * @returns {Promise<Blob>} - ZIP file Blob containing the images.
     */
    async pdfToImages(file, options, progressCallback) {
        if (!window['pdfjs-dist/build/pdf']) {
            throw new Error('PDF.js is not loaded');
        }
        if (!window.JSZip) {
            throw new Error('JSZip is not loaded');
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        const JSZip = window.JSZip;
        const zip = new JSZip();

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const srcPdf = await loadingTask.promise;
        const totalPages = srcPdf.numPages;

        const format = options.format || 'image/jpeg';
        const dpi = options.dpi || 150;
        const quality = options.quality !== undefined ? options.quality : 0.92;
        const extension = format === 'image/png' ? 'png' : 'jpg';

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await srcPdf.getPage(pageNum);
            
            // PDF default size is 72 points per inch (DPI)
            const scale = dpi / 72;
            const viewport = page.getViewport({ scale });
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            await page.render(renderContext).promise;
            
            const imgBlob = await new Promise((resolve) => {
                canvas.toBlob(resolve, format, quality);
            });
            
            // Generate filename, padded based on total pages
            const paddedNum = String(pageNum).padStart(String(totalPages).length, '0');
            const fileName = `page-${paddedNum}.${extension}`;
            
            zip.file(fileName, imgBlob);
            
            if (progressCallback) {
                progressCallback(pageNum, totalPages);
            }
        }
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        return zipBlob;
    },

    /**
     * Adds page numbers to a PDF document.
     * @param {File} file - Source PDF file.
     * @param {Object} options - Numbering options.
     * @returns {Promise<Blob>} - Modified PDF Blob.
     */
    async addPageNumbers(file, options) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        const totalPages = pages.length;

        const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        const fontSize = options.fontSize || 10;
        const startNumber = options.startNumber || 1;
        const position = options.position || 'bottom-center'; // bottom-left, bottom-center, bottom-right, top-left, top-center, top-right
        const fontColor = options.fontColor || '#000000';

        // Parse hex color
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        const fullHex = fontColor.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
        const rgb = result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 0, b: 0 };
        const color = PDFLib.rgb(rgb.r, rgb.g, rgb.b);

        // Process page ranges if specified (e.g. "1-5", "all", etc.)
        let targetPages = [];
        if (options.pageRange && options.pageRange !== 'all') {
            const ranges = options.pageRange.split(',');
            for (const range of ranges) {
                const parts = range.trim().split('-');
                if (parts.length === 1) {
                    const pageNum = parseInt(parts[0]);
                    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                        targetPages.push(pageNum);
                    }
                } else if (parts.length === 2) {
                    const start = parseInt(parts[0]);
                    const end = parseInt(parts[1]);
                    if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= totalPages) {
                        for (let p = start; p <= end; p++) {
                            targetPages.push(p);
                        }
                    }
                }
            }
            // De-duplicate and sort
            targetPages = [...new Set(targetPages)].sort((a, b) => a - b);
        } else {
            for (let p = 1; p <= totalPages; p++) {
                targetPages.push(p);
            }
        }

        for (const pageNum of targetPages) {
            const page = pages[pageNum - 1];
            const pageVal = startNumber + (pageNum - 1);
            
            let displayText = `${pageVal}`;
            if (options.format === 'page-of-total') {
                displayText = `Page ${pageVal} of ${totalPages}`;
            } else if (options.format === 'page-x') {
                displayText = `Page ${pageVal}`;
            }

            const textWidth = helveticaFont.widthOfTextAtSize(displayText, fontSize);
            const textHeight = helveticaFont.heightAtSize(fontSize);

            const pageWidth = page.getWidth();
            const pageHeight = page.getHeight();

            let x = 30;
            let y = 30;

            // Compute Y position
            if (position.startsWith('top')) {
                y = pageHeight - 30 - textHeight;
            } else {
                y = 30;
            }

            // Compute X position
            if (position.endsWith('left')) {
                x = 30;
            } else if (position.endsWith('right')) {
                x = pageWidth - 30 - textWidth;
            } else {
                // center
                x = (pageWidth - textWidth) / 2;
            }

            page.drawText(displayText, {
                x,
                y,
                size: fontSize,
                font: helveticaFont,
                color
            });
        }

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    },

    /**
     * Adds text watermark to a PDF document.
     * @param {File} file - Source PDF file.
     * @param {Object} options - Watermark options.
     * @returns {Promise<Blob>} - Watermarked PDF Blob.
     */
    async addWatermark(file, options) {
        if (!window.PDFLib) {
            throw new Error('PDFLib is not loaded');
        }

        const PDFLib = window.PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        const text = options.text || 'DRAFT';
        const fontSize = options.fontSize || 50;
        const opacity = options.opacity !== undefined ? parseFloat(options.opacity) : 0.3;
        const rotation = options.rotation !== undefined ? parseInt(options.rotation) : 45;
        const fontColor = options.fontColor || '#000000';

        // Parse hex color
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        const fullHex = fontColor.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
        const rgb = result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 0, b: 0 };
        const color = PDFLib.rgb(rgb.r, rgb.g, rgb.b);

        for (const page of pages) {
            const textWidth = helveticaFont.widthOfTextAtSize(text, fontSize);
            const textHeight = helveticaFont.heightAtSize(fontSize);

            // Centre on the area a reader actually sees. Viewers display the CropBox,
            // which defaults to the MediaBox, and either one can start away from 0,0;
            // centring on width/2, height/2 put the mark off-centre on cropped pages.
            const box = page.getCropBox();
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            // A page with /Rotate is turned by the viewer after it is drawn, which turns
            // the watermark with it: 0 read vertically on a page set to 90 (including
            // pages turned by our own Rotate tool). Adding the page's rotation makes the
            // mark appear at the angle the user chose.
            const pageRotation = ((page.getRotation().angle % 360) + 360) % 360;
            const angle = rotation + pageRotation;

            // Offset the origin so the text spins around its own centre.
            const rad = (angle * Math.PI) / 180;
            const drawX = centerX - (textWidth / 2) * Math.cos(rad) + (textHeight / 2) * Math.sin(rad);
            const drawY = centerY - (textWidth / 2) * Math.sin(rad) - (textHeight / 2) * Math.cos(rad);

            page.drawText(text, {
                x: drawX,
                y: drawY,
                size: fontSize,
                font: helveticaFont,
                color,
                opacity,
                rotate: PDFLib.degrees(angle)
            });
        }

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    },

    /**
     * Checks if a PDF file is password protected/encrypted.
     * @param {File} file - Source PDF file.
     * @returns {Promise<boolean>} - True if encrypted, false otherwise.
     */
    async checkIsEncrypted(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdfBytes = new Uint8Array(arrayBuffer);
        const { isEncrypted } = await import('./pdf-crypto.js?v=35');
        const info = await isEncrypted(pdfBytes);
        return info.encrypted;
    },

    /**
     * Describes a file's encryption for the UI. Unlike checkIsEncrypted, a
     * scheme pdf-crypto cannot parse is reported as encrypted-but-unsupported
     * rather than thrown, so callers can explain instead of failing.
     * @param {File} file
     * @returns {Promise<{encrypted: boolean, supported?: boolean,
     *   algorithm?: string, opensWithoutPassword?: boolean}>}
     */
    async encryptionInfo(file) {
        const pdfBytes = new Uint8Array(await file.arrayBuffer());
        const { isEncrypted } = await import('./pdf-crypto.js?v=35');
        try {
            const info = await isEncrypted(pdfBytes);
            return info.encrypted ? { ...info, supported: true } : { encrypted: false };
        } catch (e) {
            if (/Unsupported encryption/.test(e.message)) return { encrypted: true, supported: false };
            // Fall back to the trailer itself: an /Encrypt entry means encrypted.
            const tail = new TextDecoder('latin1').decode(pdfBytes.subarray(Math.max(0, pdfBytes.length - 4096)));
            const head = new TextDecoder('latin1').decode(pdfBytes.subarray(0, 4096));
            return /\/Encrypt\s/.test(tail) || /\/Encrypt\s/.test(head)
                ? { encrypted: true, supported: false }
                : { encrypted: false };
        }
    },

    /**
     * Encrypts/password-protects a PDF file.
     * @param {File} file - Source PDF file.
     * @param {string} password - User password to encrypt the PDF with.
     * @returns {Promise<Blob>} - Encrypted PDF Blob.
     */
    async protectPDF(file, password) {
        const arrayBuffer = await file.arrayBuffer();
        const pdfBytes = new Uint8Array(arrayBuffer);
        const { encryptPDF, isEncrypted } = await import('./pdf-crypto.js?v=35');

        // Refuse already-encrypted input. encryptPDF() loads with
        // ignoreEncryption, so running it twice RC4s the existing ciphertext a
        // second time: the result opens with the new password but its pages are
        // empty and the original password no longer works. That is
        // unrecoverable, so the engine refuses rather than trusting its caller
        // — the UI has its own check, but this operation is destructive enough
        // that it must not depend on which code path reached it.
        let info;
        try {
            info = await isEncrypted(pdfBytes);
        } catch (probeErr) {
            // Cannot parse the encryption dictionary (e.g. AES-256 R5 or a certificate handler).
            // "Cannot tell" is not "not encrypted", and guessing wrong destroys
            // the file, so refuse and let the caller explain why.
            throw new Error(
                'Could not determine whether this PDF is already password protected, ' +
                'so it was not modified. Encrypting an already-protected PDF would ' +
                'permanently damage it.'
            );
        }
        if (info && info.encrypted) {
            throw new Error(
                'This PDF is already password protected. Remove the existing password ' +
                'with the Unlock PDF tool first, then set a new one.'
            );
        }

        const encryptedBytes = await encryptPDF(pdfBytes, password);
        return new Blob([encryptedBytes], { type: 'application/pdf' });
    },

    /**
     * Decrypts/unlocks a password-protected PDF file.
     * @param {File} file - Source PDF file.
     * @param {string} password - Password to unlock the PDF.
     * @returns {Promise<Blob>} - Decrypted PDF Blob.
     */
    async unlockPDF(file, password) {
        const arrayBuffer = await file.arrayBuffer();
        const pdfBytes = new Uint8Array(arrayBuffer);
        const { decryptPDF } = await import('./pdf-crypto.js?v=35');
        const decryptedBytes = await decryptPDF(pdfBytes, password);
        return new Blob([decryptedBytes], { type: 'application/pdf' });
    },

    /**
     * Lists the editable text runs on one page, with the geometry needed to
     * match them against what pdf.js renders on screen.
     * @param {File|PDFDocument} source - Source PDF file, or a pdf-lib document
     *   already loaded from it (lets a caller parse once and query every page).
     * @param {number} pageNum - 1-based page number.
     * @returns {Promise<Array>} runs: {index, x, y, fontSize, fontName, op}
     */
    async listTextRuns(source, pageNum) {
        if (!window.PDFLib) throw new Error('PDFLib is not loaded');
        const PDFLib = window.PDFLib;
        const pdfDoc = source instanceof PDFLib.PDFDocument
            ? source
            : await PDFLib.PDFDocument.load(await source.arrayBuffer());
        const page = pdfDoc.getPage(pageNum - 1);
        const runs = PDFTools._pageTextRuns(PDFLib, pdfDoc, page);
        const out = runs.map((r, i) => ({
            index: i,
            x: r.trm[4],
            y: r.trm[5],
            fontSize: r.fontSize,
            fontName: r.fontName,
            op: r.op,
        }));
        out.formBoxes = runs.formBoxes;   // see _formBoxes
        return out;
    },

    /**
     * Groups pdf.js text items so that each group covers whole operators.
     *
     * pdf.js sometimes splits ONE Tj/TJ operator into several items: per word
     * in some generators' output, or across a wide gap inside a TJ array. The
     * engine can only remove whole operators, so editing one of those items on
     * its own would delete its siblings too (or, for a later item, find
     * nothing to replace). Grouping makes the clickable unit match what can
     * actually be replaced: an item joins the group to its left when no
     * operator starts exactly where it starts, and the operator whose text
     * reaches its start began inside that group.
     *
     * Text drawn by a small form XObject (a stamp, a flattened form field) is
     * never grouped: no page-level operator draws it, so the nearest operator
     * to its left says nothing about it.
     *
     * Matching uses the same tolerances as replaceTextInPDF, so a group's span
     * claims exactly the operators it shows.
     *
     * @param {Array<{str, x, y, width, fontSize}>} items - user-space geometry
     * @param {Array<{x, y}>} runs - operator start points (listTextRuns),
     *   optionally carrying .formBoxes
     * @returns {Array<{str, x, y, width, fontSize, parts}>} in reading order
     */
    groupTextItems(items, runs) {
        const yTol = (fs) => Math.max(1.5, (fs || 12) * 0.3);
        const boxes = runs.formBoxes || [];
        const lines = [];
        const sorted = items.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
        for (const it of sorted) {
            const line = lines[lines.length - 1];
            if (line && Math.abs(line[0].y - it.y) <= yTol(line[0].fontSize)) line.push(it);
            else lines.push([it]);
        }

        const out = [];
        for (const line of lines) {
            line.sort((a, b) => a.x - b.x);
            const ref = line[0];
            const onLine = runs.filter(r => Math.abs(r.y - ref.y) <= yTol(ref.fontSize));
            let group = null;
            for (const it of line) {
                const foreign = PDFTools._inSmallForm(boxes, it.x, it.y, it.fontSize);
                const startsHere = onLine.some(r => Math.abs(r.x - it.x) <= 0.5);
                let owner = null;
                for (const r of onLine) {
                    if (r.x < it.x - 0.5 && (!owner || r.x > owner.x)) owner = r;
                }
                const joins = group && !group.foreign && !foreign && !startsHere && owner &&
                    owner.x >= group.x - 0.5 && owner.x <= group.x + group.width + 0.5;
                if (joins) {
                    const right = group.x + group.width;
                    const gap = it.x - right;
                    const sep = (/\s$/.test(group.str) || /^\s/.test(it.str) ||
                        gap < (it.fontSize || 12) * 0.15) ? '' : ' ';
                    group.str += sep + it.str;
                    group.width = Math.max(right, it.x + it.width) - group.x;
                    group.fontSize = Math.max(group.fontSize, it.fontSize);
                    group.parts += 1;
                } else {
                    group = { str: it.str, x: it.x, y: it.y, width: it.width, fontSize: it.fontSize, parts: 1, foreign };
                    out.push(group);
                }
            }
        }
        return out;
    },

    /**
     * Internal: is (x, y) inside a form XObject at most ~3 lines tall? Small
     * boxes are stamps and flattened form fields whose text sits on the same
     * baseline as page text without being drawn by any page-level operator.
     * Page-sized boxes (letterhead templates) are ignored: text on top of them
     * is ordinary page text.
     */
    _inSmallForm(boxes, x, y, fontSize) {
        const maxH = 3 * (fontSize || 12);
        return (boxes || []).some(b => b.y1 - b.y0 <= maxH &&
            x >= b.x0 - 0.5 && x <= b.x1 + 0.5 && y >= b.y0 - 0.5 && y <= b.y1 + 0.5);
    },

    /**
     * Internal: page-space bounding boxes of the form XObjects a page draws.
     * @param {Array<{name, ctm}>} invocations - from PDFTextScanner.scan().xobjects
     * @returns {Array<{x0, y0, x1, y1}>}
     */
    _formBoxes(PDFLib, page, invocations) {
        const boxes = [];
        if (!invocations.length) return boxes;
        let xobjs;
        try {
            xobjs = page.node.Resources().lookup(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict);
        } catch (e) {
            return boxes;
        }
        if (!xobjs) return boxes;
        const nums = (arr) => arr ? arr.asArray().map(n => (n.asNumber ? n.asNumber() : 0)) : null;
        const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        for (const { name, ctm } of invocations) {
            try {
                const dict = xobjs.lookup(PDFLib.PDFName.of(name)).dict;
                if (String(dict.lookup(PDFLib.PDFName.of('Subtype'))) !== '/Form') continue;
                // lookupMaybe: plain lookup() with a type throws on a missing key,
                // and /Matrix is optional.
                const bbox = nums(dict.lookupMaybe(PDFLib.PDFName.of('BBox'), PDFLib.PDFArray));
                if (!bbox || bbox.length < 4) continue;
                const matrix = nums(dict.lookupMaybe(PDFLib.PDFName.of('Matrix'), PDFLib.PDFArray)) || [1, 0, 0, 1, 0, 0];
                const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
                    .map(p => apply(ctm, apply(matrix, p)));
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
                boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
            } catch (e) {
                // Unreadable or missing XObject: nothing to exclude.
            }
        }
        return boxes;
    },

    /**
     * Internal: normalize the page, then scan every content stream it owns.
     * Returns runs annotated with the stream ref they live in.
     */
    _pageTextRuns(PDFLib, pdfDoc, page) {
        // normalize() FIRST. It calls wrapContentStreams, which inserts
        // push/pop graphics-state streams into Contents — so any index or ref
        // recorded before this point would refer to the wrong stream.
        page.node.normalize();

        const ctx = pdfDoc.context;
        const raw = page.node.get(PDFLib.PDFName.of('Contents'));
        const resolved = ctx.lookup(raw);
        const refs = (resolved instanceof PDFLib.PDFArray) ? resolved.asArray() : [raw];

        const runs = [];
        const invocations = [];
        for (const ref of refs) {
            const obj = ctx.lookup(ref);
            let bytes;
            if (obj instanceof PDFLib.PDFRawStream) {
                bytes = PDFLib.decodePDFRawStream(obj).decode();
            } else if (obj instanceof PDFLib.PDFContentStream) {
                bytes = obj.getUnencodedContents();
            } else {
                continue;
            }
            const scanned = PDFTextScanner.scan(bytes);
            for (const r of scanned) {
                runs.push({ ...r, ref, streamBytes: bytes });
            }
            invocations.push(...scanned.xobjects);
        }
        // Areas drawn by form XObjects, whose text no run above accounts for.
        runs.formBoxes = PDFTools._formBoxes(PDFLib, page, invocations);
        return runs;
    },

    /**
     * Replaces existing text on a page: removes the original text-showing
     * operator from the content stream, then draws the replacement on top.
     *
     * This is real replacement, not a cover-up. The original operator's bytes
     * are spliced out, so the old text is not recoverable from the output.
     *
     * @param {File} file - Source PDF file.
     * @param {Array} edits - [{pageNum, newText, runIndex? | x, y, width,
     *   fontSize?, color?, lineItems?}]. lineItems: [{x, width}] of every
     *   pdf.js item on the edited line; when given, an edit whose operators
     *   also draw words outside its span is refused instead of applied.
     * @returns {Promise<{blob: Blob, warnings: string[]}>}
     */
    async replaceTextInPDF(file, edits) {
        if (!window.PDFLib) throw new Error('PDFLib is not loaded');
        const PDFLib = window.PDFLib;
        const bytes = new Uint8Array(await file.arrayBuffer());

        // Encrypted input would give the scanner ciphertext to parse, and
        // ignoreEncryption would let it write a corrupt file. Refuse instead.
        const { isEncrypted } = await import('./pdf-crypto.js?v=35');
        let encInfo = null;
        try { encInfo = await isEncrypted(bytes); } catch (e) { /* not parseable as encrypted */ }
        if (encInfo && encInfo.encrypted) {
            throw new Error('This PDF is password protected. Unlock it first, then edit the text.');
        }

        const pdfDoc = await PDFLib.PDFDocument.load(bytes);
        const warnings = [];
        const fontCache = new Map();

        // Tf names a page resource ("F2", "TT1"); the family and weight are in
        // that font's /BaseFont ("AAAAAA+Arial-BoldMT"). Resolve it, falling
        // back to the resource name if the dictionary cannot be read.
        const baseFontName = (page, resName) => {
            try {
                const fonts = page.node.Resources().lookup(PDFLib.PDFName.of('Font'), PDFLib.PDFDict);
                const dict = fonts.lookup(PDFLib.PDFName.of(resName), PDFLib.PDFDict);
                return dict.lookup(PDFLib.PDFName.of('BaseFont'), PDFLib.PDFName).decodeText();
            } catch (e) {
                return resName;
            }
        };

        const pickFont = async (fontName) => {
            // The page's own font is almost always a subset containing only the
            // glyphs the author used, and pdf-lib cannot embed new text into
            // someone else's subset. So replacement text uses a standard font,
            // guessed from the original's BaseFont name.
            const n = (fontName || '').toLowerCase();
            const bold = /bold|black|heavy/.test(n);
            const italic = /italic|oblique/.test(n);
            let key;
            if (/times|roman|georgia/.test(n) || (/serif/.test(n) && !/sans/.test(n))) {
                key = bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold'
                    : italic ? 'TimesRomanItalic' : 'TimesRoman';
            } else if (/courier|mono|menlo|monaco|consolas/.test(n)) {
                key = bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold'
                    : italic ? 'CourierOblique' : 'Courier';
            } else {
                key = bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold'
                    : italic ? 'HelveticaOblique' : 'Helvetica';
            }
            if (!fontCache.has(key)) {
                fontCache.set(key, await pdfDoc.embedFont(PDFLib.StandardFonts[key]));
            }
            return { font: fontCache.get(key), key };
        };

        // Group edits per page so each page is scanned once.
        const byPage = new Map();
        for (const e of edits) {
            if (!byPage.has(e.pageNum)) byPage.set(e.pageNum, []);
            byPage.get(e.pageNum).push(e);
        }

        for (const [pageNum, pageEdits] of byPage) {
            const page = pdfDoc.getPage(pageNum - 1);
            const runs = PDFTools._pageTextRuns(PDFLib, pdfDoc, page);

            // Resolve each edit to the set of operators it covers.
            //
            // A visual phrase is usually NOT one operator. Producers split a
            // line across many Tj calls to apply kerning, so "Dummy PDF file"
            // can be six operators while pdf.js reports it as one text item.
            // An edit therefore takes the clicked item's span (x, y, width) and
            // claims every operator sitting on that baseline inside it —
            // otherwise the user replaces one fragment and the rest survives.
            const resolved = [];
            for (const e of pageEdits) {
                let group;
                if (typeof e.runIndex === 'number') {
                    group = runs[e.runIndex] ? [runs[e.runIndex]] : [];
                } else {
                    const yTol = Math.max(1.5, (e.fontSize || 12) * 0.3);
                    const x0 = e.x - 0.5;
                    const x1 = e.x + (e.width || 0) + 0.5;
                    group = runs.filter(r =>
                        Math.abs(r.trm[5] - e.y) <= yTol &&
                        r.trm[4] >= x0 && r.trm[4] <= x1);
                }
                if (!group.length) {
                    warnings.push(`Page ${pageNum}: could not locate that text in the page's content stream, so nothing was changed there.`);
                    continue;
                }
                // Removing an operator removes ALL of its text. If any word on
                // this line sits after the clicked span but before the next
                // operator starts, a claimed operator draws it too, and
                // replacing the clicked text would silently delete it. Refuse.
                // Words inside a small form XObject (stamp, flattened field)
                // are drawn by that XObject, not by any operator here.
                if (Array.isArray(e.lineItems) && typeof e.runIndex !== 'number') {
                    const x1 = e.x + (e.width || 0) + 0.5;
                    const yTol = Math.max(1.5, (e.fontSize || 12) * 0.3);
                    const spills = group.some(r => {
                        const next = runs
                            .filter(o => Math.abs(o.trm[5] - r.trm[5]) <= yTol && o.trm[4] > r.trm[4] + 0.5)
                            .reduce((m, o) => Math.min(m, o.trm[4]), Infinity);
                        return e.lineItems.some(it => it.x > x1 && it.x < next - 0.5 &&
                            !PDFTools._inSmallForm(runs.formBoxes, it.x, e.y, e.fontSize));
                    });
                    if (spills) {
                        warnings.push(`Page ${pageNum}: that text is stored together with more words on its line, so replacing it alone would delete them. Left unchanged.`);
                        continue;
                    }
                }
                // Anchor the replacement at the leftmost operator's baseline.
                group.sort((a, b) => a.trm[4] - b.trm[4]);
                resolved.push({ edit: e, group, anchor: group[0] });
            }

            // Splice from the highest byte offset down, so earlier removals
            // never shift offsets of operators still to be removed.
            const chosen = resolved
                .flatMap(({ edit, group, anchor }) =>
                    group.map(run => ({ edit, run, anchor, draw: run === anchor })))
                .sort((a, b) => b.run.start - a.run.start);

            const patched = new Map();   // ref -> working byte array

            for (const { edit, run, anchor, draw } of chosen) {
                // Rotated or skewed text would need the replacement drawn along
                // the same axis; drawText only writes horizontally, so refuse
                // rather than silently produce misaligned output.
                if (Math.abs(run.trm[1]) > 1e-6 || Math.abs(run.trm[2]) > 1e-6) {
                    if (draw) warnings.push(`Page ${pageNum}: that text is rotated or skewed, which this tool cannot rewrite. Left unchanged.`);
                    continue;
                }

                const { font, key } = await pickFont(baseFontName(page, anchor.fontName));
                const size = edit.fontSize || anchor.fontSize || 12;

                // Standard fonts are WinAnsi. Anything outside it throws inside
                // drawText, so check before touching the document.
                const encodable = new Set(font.getCharacterSet ? font.getCharacterSet() : []);
                if (encodable.size) {
                    const bad = [...edit.newText].filter(ch => !encodable.has(ch.codePointAt(0)));
                    if (bad.length) {
                        if (draw) warnings.push(`Page ${pageNum}: cannot type ${[...new Set(bad)].join(' ')} — only Western European characters are supported. Left unchanged.`);
                        continue;
                    }
                }

                const cur = patched.get(run.ref) || run.streamBytes;
                // Tj/TJ vanish cleanly. ' and " also advance a line, so replace
                // them with T* to preserve the layout of everything after.
                const repl = (run.op === "'" || run.op === '"')
                    ? new TextEncoder().encode('T*\n')
                    : new Uint8Array(0);
                const next = new Uint8Array(cur.length - (run.end - run.start) + repl.length);
                next.set(cur.subarray(0, run.start), 0);
                next.set(repl, run.start);
                next.set(cur.subarray(run.end), run.start + repl.length);
                patched.set(run.ref, next);

                // Every operator in the group gets removed, but the replacement
                // is drawn exactly once, at the leftmost baseline.
                if (!draw) continue;

                const width = font.widthOfTextAtSize(edit.newText, size);
                page.drawText(edit.newText, {
                    x: anchor.trm[4],
                    y: anchor.trm[5],
                    size,
                    font,
                    color: edit.color
                        ? PDFLib.rgb(edit.color.r, edit.color.g, edit.color.b)
                        : PDFLib.rgb(0, 0, 0),
                });
                warnings.push(`Page ${pageNum}: replacement drawn in ${key} at ${Math.round(width)}pt wide. The original font could not be reused, and text after it on the same line does not move — check the result before sending it.`);
            }

            // assign(), never register() + array.set(): pdf-lib's writer
            // serializes every indirect object with no reachability pass, so a
            // replaced-but-still-registered stream would leave the ORIGINAL
            // text in the file as a recoverable orphan.
            for (const [ref, buf] of patched) {
                pdfDoc.context.assign(ref, pdfDoc.context.flateStream(buf));
            }
        }

        const outBytes = await pdfDoc.save();
        return { blob: new Blob([outBytes], { type: 'application/pdf' }), warnings };
    }
};
