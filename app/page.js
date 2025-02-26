"use client";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Script from "next/script";

export default function Home() {
  /* -------------------- Dark/Light Mode & Settings -------------------- */
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoFormatPaste, setAutoFormatPaste] = useState(true);

  /* -------------------- PDF & Annotation State -------------------- */
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [originalPdfBytes, setOriginalPdfBytes] = useState(null);
  // Store unscaled page dimensions
  const pageSizesRef = useRef([]);
  // Each annotation => { pageIndex, xRatio, yRatio, text, fontSize, color, highlight, widthRatio, heightRatio }
  const [annotations, setAnnotations] = useState([]);
  const [placingAnnotation, setPlacingAnnotation] = useState(false);

  // Index of the currently "active" box => we reflect its color, highlight, fontSize in the toolbar
  const [activeIndex, setActiveIndex] = useState(null);

  /* -------------------- Zoom & Font Size -------------------- */
  const zoomOptions = [
    "Automatic Zoom",
    "Actual Size",
    "Page Fit",
    "Page Width",
    "50%",
    "75%",
    "100%",
    "125%",
    "150%",
    "200%",
    "300%",
    "400%",
  ];
  const [zoomChoice, setZoomChoice] = useState("Automatic Zoom");
  const [zoomScale, setZoomScale] = useState(1.0);

  // The user’s text style (1..100 PDF units)
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffff00");

  // PDF container
  const pdfContainerRef = useRef(null);

  /* ---------------------------------------------------------------- */
  /* 1) hexToRgba must be declared at the top to avoid reference errors. */
  function hexToRgba(hex, alpha = 1.0) {
    if (!hex.startsWith("#")) return hex;
    let raw = hex.slice(1);
    if (raw.length === 3) {
      raw = raw
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const num = parseInt(raw, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ---------------------------------------------------------------- */
  /* 2) computeDomFontSize => used by applyAnnotations & toolbar updates. */
  function computeDomFontSize(ann, pageEl) {
    // Convert annotation.fontSize from PDF units => DOM px
    if (!pageSizesRef.current[ann.pageIndex]) return ann.fontSize;
    const { height: unscaledH } = pageSizesRef.current[ann.pageIndex];
    const domH = pageEl.clientHeight;
    const ratio = domH / unscaledH;
    return Math.max(2, ann.fontSize * ratio);
  }

  /* -------------------- Dark Mode on Mount -------------------- */
  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setDarkMode(true);
    }
  }, []);
  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  /* -------------------- LOAD PDF -------------------- */
  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return;
    loadPDF(file);
  }

  async function loadPDF(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const bytes = new Uint8Array(reader.result);
      setOriginalPdfBytes(bytes);

      const doc = await window.pdfjsLib.getDocument(bytes).promise;
      setPdfDoc(doc);
      setPdfLoaded(true);

      // gather unscaled page sizes
      const count = doc.numPages;
      const arr = [];
      for (let i = 1; i <= count; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        arr.push({ width: viewport.width, height: viewport.height });
      }
      pageSizesRef.current = arr;

      setZoomChoice("Automatic Zoom");
      setZoomScale(1.0);

      renderPDF(doc, 1.0);
    };
    reader.readAsArrayBuffer(file);
  }

  /* -------------------- Zoom Logic + High-Res Rendering -------------------- */
  function interpretZoomChoice(choice) {
    if (!pageSizesRef.current.length) return 1.0;
    const firstPage = pageSizesRef.current[0];
    const unscaledW = firstPage.width;
    const unscaledH = firstPage.height;

    switch (choice) {
      case "Automatic Zoom":
        return 1.0;
      case "Actual Size":
        return 1.0;
      case "Page Fit": {
        const offset = 200;
        const h = window.innerHeight - offset;
        return Math.max(0.1, h / unscaledH);
      }
      case "Page Width": {
        const offset = 100;
        const w = window.innerWidth - offset;
        return Math.max(0.1, w / unscaledW);
      }
      default:
        if (choice.endsWith("%")) {
          const val = parseFloat(choice);
          if (!isNaN(val)) return val / 100;
        }
        return 1.0;
    }
  }

  async function handleZoomChange(newChoice) {
    setZoomChoice(newChoice);
    if (!pdfDoc) return;
    const newScale = interpretZoomChoice(newChoice);
    setZoomScale(newScale);
    await renderPDF(pdfDoc, newScale);
  }

  async function renderPDF(doc, scale) {
    const container = pdfContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const dpr = window.devicePixelRatio || 1;

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const width = viewport.width;
      const height = viewport.height;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // device pixel ratio
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);

      const pageDiv = document.createElement("div");
      pageDiv.className = "pdf-page";
      pageDiv.style.width = width + "px";
      pageDiv.style.height = height + "px";

      pageDiv.appendChild(canvas);
      container.appendChild(pageDiv);

      await page.render({ canvasContext: ctx, viewport }).promise;

      // text layer
      const textLayer = document.createElement("div");
      textLayer.className = "text-layer";
      pageDiv.appendChild(textLayer);
    }
    applyAnnotations();
  }

  // re-render if doc changes, zoom changes, or annotation count changes
  useEffect(() => {
    if (!pdfLoaded || !pdfDoc) return;
    renderPDF(pdfDoc, zoomScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pdfLoaded, zoomScale, annotations.length]);

  /* -------------------- Update active annotation on toolbar changes -------------------- */
  // If user changes fontSize/textColor/highlightColor, we update the active annotation
  // and its DOM node, so it instantly grows/shrinks or changes color while keeping focus.
  useEffect(() => {
    if (activeIndex == null) return;
    const ann = annotations[activeIndex];
    if (!ann) return;

    // update the annotation in state
    setAnnotations((prev) => {
      const arr = [...prev];
      if (arr[activeIndex]) {
        arr[activeIndex].fontSize = Math.min(100, Math.max(1, fontSize));
        arr[activeIndex].color = textColor;
        arr[activeIndex].highlight = highlightColor;
      }
      return arr;
    });

    // Then update the DOM node
    const container = pdfContainerRef.current;
    if (!container) return;
    const pages = container.querySelectorAll(".pdf-page");
    if (ann.pageIndex >= pages.length) return;
    const pageEl = pages[ann.pageIndex];
    const textLayer = pageEl.querySelector(".text-layer");
    if (!textLayer) return;
    const box = textLayer.querySelector(
      `.editable-text[data-annindex='${activeIndex}']`
    );
    if (!box) return;

    // recalc DOM font size
    const newSize = computeDomFontSize(ann, pageEl);
    box.style.fontSize = newSize + "px";
    box.style.color = ann.color;
    box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize, textColor, highlightColor]);

  /* -------------------- applyAnnotations => draws boxes, resizers, etc. -------------------- */
  function applyAnnotations() {
    const container = pdfContainerRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll(".pdf-page");

    // clear old
    pageEls.forEach((p) => {
      const t = p.querySelector(".text-layer");
      if (t) t.innerHTML = "";
    });

    annotations.forEach((ann, idx) => {
      if (ann.pageIndex >= pageEls.length) return;
      const pageEl = pageEls[ann.pageIndex];
      const textLayer = pageEl.querySelector(".text-layer");
      if (!textLayer) return;

      const domSize = computeDomFontSize(ann, pageEl);
      const x = ann.xRatio * pageEl.clientWidth;
      const y = ann.yRatio * pageEl.clientHeight;

      const box = document.createElement("div");
      box.className = "editable-text";
      box.setAttribute("data-annindex", idx.toString());
      box.contentEditable = pdfLoaded ? "true" : "false";
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.fontSize = domSize + "px";
      box.style.color = ann.color;
      box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
      box.innerText = ann.text;

      // If annotation has widthRatio, heightRatio => apply
      if (ann.widthRatio) {
        box.style.width = ann.widthRatio * pageEl.clientWidth + "px";
      }
      if (ann.heightRatio) {
        box.style.height = ann.heightRatio * pageEl.clientHeight + "px";
      }

      // Draggable
      let isDragging = false;
      let offsetX = 0,
        offsetY = 0;
      box.addEventListener("mousedown", (e) => {
        if (!pdfLoaded) return;
        // skip if resizer clicked
        if (e.target.classList.contains("resizer")) return;
        isDragging = true;
        const r = box.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        e.stopPropagation();

        // user focusing => set toolbar from annotation
        setActiveIndex(idx);
        setFontSize(Math.min(100, ann.fontSize));
        setTextColor(ann.color);
        setHighlightColor(ann.highlight);
      });
      document.addEventListener("mousemove", (e) => {
        if (isDragging) {
          const rect = pageEl.getBoundingClientRect();
          let newX = e.clientX - rect.left - offsetX;
          let newY = e.clientY - rect.top - offsetY;

          // clamp
          const boxW = box.offsetWidth;
          const boxH = box.offsetHeight;
          if (newX < 0) newX = 0;
          if (newY < 0) newY = 0;
          if (newX > rect.width - boxW) newX = rect.width - boxW;
          if (newY > rect.height - boxH) newY = rect.height - boxH;

          box.style.left = newX + "px";
          box.style.top = newY + "px";

          setAnnotations((prev) => {
            const arr = [...prev];
            arr[idx].xRatio = newX / rect.width;
            arr[idx].yRatio = newY / rect.height;
            return arr;
          });
        }
      });
      document.addEventListener("mouseup", () => {
        isDragging = false;
        measureWidthRatio(box, ann, pageEl);
      });

      // Placeholder logic
      box.addEventListener("focus", () => {
        if (box.innerText === "Edit me!") {
          box.innerText = "";
          setAnnotations((prev) => {
            const arr = [...prev];
            arr[idx].text = "";
            return arr;
          });
        }
      });
      // Pasting
      box.addEventListener("paste", (e) => {
        if (!autoFormatPaste) return;
        e.preventDefault();
        const txt = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, txt);
      });
      // on input => store text
      box.addEventListener("input", () => {
        setAnnotations((prev) => {
          const arr = [...prev];
          arr[idx].text = box.innerText;
          return arr;
        });
      });
      // if empty on backspace => remove
      box.addEventListener("keydown", (e) => {
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          !box.innerText.trim()
        ) {
          e.preventDefault();
          setAnnotations((prev) => prev.filter((_, i) => i !== idx));
        }
      });

      // Resizer handle
      const resizer = document.createElement("div");
      resizer.className = "resizer";
      box.appendChild(resizer);

      let isResizing = false;
      let startW = 0,
        startH = 0,
        startX = 0,
        startY = 0;
      resizer.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;
        const r = box.getBoundingClientRect();
        startW = r.width;
        startH = r.height;
        startX = e.clientX;
        startY = e.clientY;
      });
      document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        let newW = startW + deltaX;
        let newH = startH + deltaY;

        // clamp min size
        if (newW < 30) newW = 30;
        if (newH < 20) newH = 20;

        // clamp so it doesn't go off the page
        const rect = pageEl.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        let left = boxRect.left - rect.left;
        let top = boxRect.top - rect.top;
        if (left + newW > rect.width) newW = rect.width - left;
        if (top + newH > rect.height) newH = rect.height - top;

        box.style.width = newW + "px";
        box.style.height = newH + "px";

        setAnnotations((prev) => {
          const arr = [...prev];
          arr[idx].widthRatio = newW / rect.width;
          arr[idx].heightRatio = newH / rect.height;
          return arr;
        });
      });
      document.addEventListener("mouseup", () => {
        isResizing = false;
      });

      textLayer.appendChild(box);
      measureWidthRatio(box, ann, pageEl);
    });
  }

  function measureWidthRatio(el, ann, pageEl) {
    const wPx = el.offsetWidth;
    const pW = pageEl.clientWidth;
    ann.widthRatio = wPx / pW;
  }

  /* -------------------- Add Text -------------------- */
  function handleAddText() {
    if (!pdfLoaded) {
      alert("Please load a PDF first!");
      return;
    }
    if (placingAnnotation) return;
    setPlacingAnnotation(true);

    // pointerEvents=none => passes clicks to PDF
    const div = document.createElement("div");
    div.className = "editable-text";
    div.style.pointerEvents = "none";
    div.style.position = "fixed";
    div.style.transform = "translate(-10px, -10px)";
    div.style.borderColor = "#d44";
    div.style.padding = "2px";
    div.innerText = "Edit me!";
    div.style.backgroundColor = hexToRgba(highlightColor, 0.4);
    div.style.color = textColor;

    // approximate the DOM font size
    let approximate = Math.min(100, fontSize);
    if (pdfDoc && pageSizesRef.current.length > 0) {
      const firstPage = pageSizesRef.current[0];
      const firstPageEl = pdfContainerRef.current?.querySelector(".pdf-page");
      if (firstPageEl) {
        const ratio = firstPageEl.clientHeight / firstPage.height;
        approximate = Math.max(2, fontSize * ratio);
        if (approximate > 100) approximate = 100;
      }
    }
    div.style.fontSize = approximate + "px";

    document.body.appendChild(div);

    const onMouseMove = (e) => {
      div.style.left = e.clientX + "px";
      div.style.top = e.clientY + "px";
    };
    document.addEventListener("mousemove", onMouseMove);

    const onClick = (e) => {
      const pageEl = e.target.closest(".pdf-page");
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        // subtract 10 => matches translate(-10px, -10px)
        const x = e.clientX - rect.left - 10;
        const y = e.clientY - rect.top - 10;

        const pages = [
          ...pdfContainerRef.current.querySelectorAll(".pdf-page"),
        ];
        const pIndex = pages.indexOf(pageEl);

        setAnnotations((prev) => [
          ...prev,
          {
            pageIndex: pIndex,
            xRatio: x / rect.width,
            yRatio: y / rect.height,
            text: "Edit me!",
            fontSize: Math.min(100, fontSize),
            color: textColor,
            highlight: highlightColor,
            widthRatio: 0,
            heightRatio: 0,
          },
        ]);

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("click", onClick);
        div.remove();
        setPlacingAnnotation(false);
      }
    };
    document.addEventListener("click", onClick);
  }

  /* -------------------- Download PDF -------------------- */
  async function handleDownload() {
    if (!pdfLoaded || !originalPdfBytes) {
      alert("No PDF loaded!");
      return;
    }
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdfDocLib = await PDFDocument.load(originalPdfBytes);
    const font = await pdfDocLib.embedFont(StandardFonts.Helvetica);

    function breakLongWord(word, font, fs, maxW) {
      const out = [];
      let cur = "";
      for (let c of word) {
        const test = cur + c;
        if (font.widthOfTextAtSize(test, fs) > maxW && cur !== "") {
          out.push(cur);
          cur = c;
        } else {
          cur = test;
        }
      }
      if (cur) out.push(cur);
      return out;
    }
    function wrapLine(line, font, fs, maxW) {
      const tokens = line.split(/\s+/).filter(Boolean);
      const lines = [];
      let currentLine = "";
      tokens.forEach((tok) => {
        const pieces = breakLongWord(tok, font, fs, maxW);
        pieces.forEach((piece) => {
          if (!currentLine) {
            currentLine = piece;
          } else {
            const testLine = currentLine + " " + piece;
            if (font.widthOfTextAtSize(testLine, fs) > maxW) {
              lines.push(currentLine);
              currentLine = piece;
            } else {
              currentLine = testLine;
            }
          }
        });
      });
      if (currentLine) lines.push(currentLine);
      return lines;
    }
    function hexToRgb(hex) {
      hex = hex.replace("#", "");
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      }
      const num = parseInt(hex, 16);
      const r = ((num >> 16) & 255) / 255;
      const g = ((num >> 8) & 255) / 255;
      const b = (num & 255) / 255;
      return rgb(r, g, b);
    }

    const pages = pdfDocLib.getPages();
    annotations.forEach((ann) => {
      if (!pages[ann.pageIndex]) return;
      const page = pages[ann.pageIndex];
      const pw = page.getWidth();
      const ph = page.getHeight();

      const fs = ann.fontSize;
      const topY = (1 - ann.yRatio) * ph;
      const lineSpace = fs * 1.2;
      // If user has widthRatio => that’s how wide we wrap
      const maxW = ann.widthRatio ? ann.widthRatio * pw : 0.8 * pw;

      const rawLines = ann.text.split(/\r?\n/);
      let wrapped = [];
      rawLines.forEach((ln) => {
        wrapped.push(...wrapLine(ln, font, fs, maxW));
      });

      if (ann.highlight.toLowerCase() !== "#ffffff") {
        let maxWidth = 0;
        for (let ln of wrapped) {
          const w = font.widthOfTextAtSize(ln, fs);
          if (w > maxWidth) maxWidth = w;
        }
        const totalH = wrapped.length * lineSpace;
        const hY = topY - totalH;
        page.drawRectangle({
          x: ann.xRatio * pw,
          y: hY,
          width: maxWidth,
          height: totalH,
          color: hexToRgb(ann.highlight),
          opacity: 0.4,
        });
      }
      for (let i = 0; i < wrapped.length; i++) {
        const baselineY = topY - fs - i * lineSpace;
        page.drawText(wrapped[i], {
          x: ann.xRatio * pw,
          y: baselineY,
          size: fs,
          font,
          color: hexToRgb(ann.color),
        });
      }
    });

    const pdfBytes = await pdfDocLib.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "edited.pdf";
    link.click();
  }

  return (
    <>
      <Head>
        <title>Ultramodern PDF Editor</title>
      </Head>

      {/* Toolbar */}
      <div id="toolbar">
        {/* Upload PDF */}
        <label htmlFor="file-input" className="button primary">
          Upload PDF
        </label>
        <input
          id="file-input"
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {/* Zoom */}
        <label style={{ marginLeft: "1rem" }}>Zoom:</label>
        <select
          value={zoomChoice}
          onChange={(e) => handleZoomChange(e.target.value)}
          style={{ padding: "4px", borderRadius: "4px" }}
        >
          {zoomOptions.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>

        {/* Add Text */}
        <button onClick={handleAddText} className="button secondary">
          + Text
        </button>

        {/* Text & Highlight color */}
        <label style={{ marginLeft: "1rem" }}>Text Color:</label>
        <input
          type="color"
          value={textColor}
          onChange={(e) => setTextColor(e.target.value)}
        />
        <label style={{ marginLeft: "1rem" }}>Highlight:</label>
        <input
          type="color"
          value={highlightColor}
          onChange={(e) => setHighlightColor(e.target.value)}
        />

        {/* Font Size (1..100) */}
        <label style={{ marginLeft: "1rem" }}>Text Size:</label>
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          value={fontSize}
          onChange={(e) => {
            let val = parseFloat(e.target.value) || 1;
            if (val > 100) val = 100;
            setFontSize(val);
          }}
          style={{ width: "60px" }}
        />

        {/* Right side => Download + Gear */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <button onClick={handleDownload} className="button primary">
            Download PDF
          </button>
          <button
            className="button secondary"
            onClick={() => setShowSettings((p) => !p)}
            style={{
              position: "relative",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              fill="currentColor"
              viewBox="0 0 16 16"
              style={{ display: "block", margin: "auto" }}
            >
              <path d="M8 4a.5.5 0 0 0-.5.5v.55a2.5 2.5 0 0 0-1.03.38l-.5-.5a.5.5 0 1 0-.71.71l.5.5A2.5 2.5 0 0 0 5.38 8H4.5a.5.5 0 0 0 0 1h.88a2.5 2.5 0 0 0 .38 1.03l-.5.5a.5.5 0 1 0 .71.71l.5-.5c.32.18.67.31 1.03.38v.55a.5.5 0 0 0 1 0v-.55c.36-.07.71-.2 1.03-.38l.5.5a.5.5 0 1 0 .71-.71l-.5-.5A2.5 2.5 0 0 0 11.45 9h.55a.5.5 0 0 0 0-1h-.55a2.5 2.5 0 0 0-.38-1.03l.5-.5a.5.5 0 1 0-.71-.71l-.5.5A2.5 2.5 0 0 0 9 5.55v-.55A.5.5 0 0 0 8 4zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
            </svg>
            {showSettings && (
              <div className="settings-panel">
                <div className="settings-item">
                  <label>Dark Mode</label>
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={(e) => setDarkMode(e.target.checked)}
                  />
                </div>
                <div className="settings-item">
                  <label>Auto-format Paste</label>
                  <input
                    type="checkbox"
                    checked={autoFormatPaste}
                    onChange={(e) => setAutoFormatPaste(e.target.checked)}
                  />
                </div>
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Drag area */}
      <div id="drop-area">
        <p>
          Drag &amp; Drop PDF Here
          <br />
          or click "Upload PDF"
        </p>
      </div>

      {/* PDF container */}
      <div ref={pdfContainerRef} id="pdf-container"></div>

      {/* pdf.js & pdf-lib */}
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.min.js"
        strategy="beforeInteractive"
      />
      <Script
        src="https://unpkg.com/pdf-lib/dist/pdf-lib.min.js"
        strategy="beforeInteractive"
      />

      <style jsx global>{`
        :root {
          --bg-color: #fafafa;
          --text-color: #333;
          --toolbar-bg: rgba(255, 255, 255, 0.9);
          --primary-button-bg: linear-gradient(135deg, #6e8efb, #a777e3);
          --secondary-button-bg: #e6e6e6;
          --accent-color: #2196f3;
        }
        body {
          margin: 0;
          padding: 0;
          background: var(--bg-color);
          color: var(--text-color);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
          transition: background 0.3s ease, color 0.3s ease;
        }
        body.dark {
          --bg-color: #121212;
          --text-color: #ddd;
          --toolbar-bg: rgba(40, 40, 40, 0.9);
          --primary-button-bg: linear-gradient(135deg, #444, #666);
          --secondary-button-bg: #555;
        }
        #toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 999;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 20px;
          backdrop-filter: blur(10px);
          background: var(--toolbar-bg);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        #drop-area {
          border: 2px dashed #bbb;
          margin: 80px 20px 20px;
          padding: 40px;
          text-align: center;
          border-radius: 6px;
          transition: background 0.3s ease;
        }
        #pdf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-bottom: 100px;
        }
        .pdf-page {
          position: relative;
          margin: 20px auto;
          background: #fff;
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        body.dark .pdf-page {
          background: #1c1c1c;
        }
        .text-layer {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .editable-text {
          position: absolute;
          pointer-events: all;
          border: 1px dashed #aaa;
          background: transparent;
          padding: 2px;
          cursor: move;
          outline: none;
          min-width: 30px;
          min-height: 20px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .resizer {
          position: absolute;
          width: 10px;
          height: 10px;
          bottom: 0;
          right: 0;
          background: #777;
          cursor: se-resize;
          pointer-events: all;
        }

        .button {
          display: inline-flex;
          align-items: center;
          border: none;
          padding: 7px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          color: #fff;
          transition: filter 0.2s ease;
        }
        .button.primary {
          background: var(--primary-button-bg);
        }
        .button.secondary {
          background: var(--secondary-button-bg);
          color: #333;
        }
        body.dark .button.secondary {
          color: #ddd;
        }
        .button:hover {
          filter: brightness(0.9);
        }
        .settings-panel {
          position: absolute;
          top: 48px;
          right: 0;
          background: var(--toolbar-bg);
          backdrop-filter: blur(10px);
          padding: 10px;
          border-radius: 6px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        .settings-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
      `}</style>
    </>
  );
}
