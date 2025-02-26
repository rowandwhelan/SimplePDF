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
  const [pdfDoc, setPdfDoc] = useState(null); // from pdf.js
  const [originalPdfBytes, setOriginalPdfBytes] = useState(null);
  // Unscaled sizes
  const pageSizesRef = useRef([]);
  // Each annotation: { id, pageIndex, xRatio, yRatio, text, fontSize, color, highlight, widthRatio }
  const [annotations, setAnnotations] = useState([]);
  const [placingAnnotation, setPlacingAnnotation] = useState(false);

  // Track which box is “active” so we can reflect that box’s font size in the toolbar
  const [activeAnnotationIndex, setActiveAnnotationIndex] = useState(null);

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
  const [fontSize, setFontSize] = useState(14); // 1..100

  // Colors
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffff00");

  // PDF container
  const pdfContainerRef = useRef(null);

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

      // fetch unscaled page sizes
      const count = doc.numPages;
      const arr = [];
      for (let i = 1; i <= count; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        arr.push({ width: viewport.width, height: viewport.height });
      }
      pageSizesRef.current = arr;

      // default scale => 1.0
      setZoomChoice("Automatic Zoom");
      setZoomScale(1.0);

      renderPDF(doc, 1.0);
    };
    reader.readAsArrayBuffer(file);
  }

  /* -------------------- ZOOM -------------------- */
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

  /* -------------------- RENDER PDF at scale -------------------- */
  async function renderPDF(doc, scale) {
    const container = pdfContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const pageDiv = document.createElement("div");
      pageDiv.className = "pdf-page";
      pageDiv.style.width = viewport.width + "px";
      pageDiv.style.height = viewport.height + "px";

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
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

  /* -------------------- Re-draw boxes if doc changes, scale changes, or annotation count changes -------------------- */
  useEffect(() => {
    // If we haven't loaded or have no doc, do nothing
    if (!pdfLoaded || !pdfDoc) return;
    renderPDF(pdfDoc, zoomScale);
    // re-render if doc changes, zoom changes, or the annotation *count* changes
    // so new or removed boxes appear immediately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pdfLoaded, zoomScale, annotations.length]);

  /* -------------------- DIRECT DOM UPDATES for text/color/size changes -------------------- */
  useEffect(() => {
    // If the user changes “fontSize” and there's an active annotation, update the DOM node’s size
    // same logic for textColor, highlightColor
    if (activeAnnotationIndex == null) return;
    const ann = annotations[activeAnnotationIndex];
    if (!ann) return;

    // Update the annotation state
    const clampedSize = Math.max(1, Math.min(fontSize, 100));
    if (ann.fontSize !== clampedSize) {
      setAnnotations((prev) => {
        const arr = [...prev];
        if (arr[activeAnnotationIndex]) {
          arr[activeAnnotationIndex].fontSize = clampedSize;
        }
        return arr;
      });
    }

    // Also update the DOM node if it exists
    const container = pdfContainerRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll(".pdf-page");
    const pageEl = pageEls[ann.pageIndex];
    if (!pageEl) return;
    const textLayer = pageEl.querySelector(".text-layer");
    if (!textLayer) return;

    // find the box that belongs to this annotation
    // e.g. we match by an ID or index. For simplicity, match by data-annid or array index
    // but we haven't implemented a stable ID approach. We can store a small marker in the DOM
    // We'll do: data-annindex
    // => We'll adapt applyAnnotations to set data-annindex=“${idx}”
    // => Then we find that node and update

    // We'll do a quick approach: if the user is currently focused on a box, we likely do “last” or the “active” node
    // We'll just find it in the text-layer
    const boxes = textLayer.querySelectorAll(".editable-text");
    for (let b of boxes) {
      const annIndexStr = b.getAttribute("data-annindex");
      if (annIndexStr == activeAnnotationIndex) {
        // found the DOM node
        // update font size
        b.style.fontSize = computeDomFontSize(ann, pageEl) + "px";
        b.style.color = ann.color;
        b.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize, textColor, highlightColor]);

  /* -------------------- applyAnnotations draws existing boxes to the DOM (no re-creation if text changes) -------------------- */
  function applyAnnotations() {
    const container = pdfContainerRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll(".pdf-page");

    // Clear text-layers
    pageEls.forEach((p) => {
      const t = p.querySelector(".text-layer");
      if (t) t.innerHTML = "";
    });

    annotations.forEach((ann, idx) => {
      if (ann.pageIndex >= pageEls.length) return;
      const pageEl = pageEls[ann.pageIndex];
      if (!pageEl) return;
      const textLayer = pageEl.querySelector(".text-layer");
      if (!textLayer) return;

      const domSize = computeDomFontSize(ann, pageEl);
      const x = ann.xRatio * pageEl.clientWidth;
      const y = ann.yRatio * pageEl.clientHeight;

      // create a box
      const box = document.createElement("div");
      box.className = "editable-text";
      box.setAttribute("data-annindex", idx.toString()); // for direct updates
      box.contentEditable = pdfLoaded ? "true" : "false";
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.fontSize = domSize + "px";
      box.style.color = ann.color;
      box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
      box.innerText = ann.text;

      let isDragging = false;
      let offsetX = 0,
        offsetY = 0;
      box.addEventListener("mousedown", (e) => {
        if (!pdfLoaded) return;
        isDragging = true;
        const r = box.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        e.stopPropagation();
        // set active annotation => update font size input
        setActiveAnnotationIndex(idx);
        // clamp in code
        let f = ann.fontSize;
        if (f < 1) f = 1;
        if (f > 100) f = 100;
        setFontSize(f);
      });
      document.addEventListener("mousemove", (e) => {
        if (isDragging) {
          const rect = pageEl.getBoundingClientRect();
          let newX = e.clientX - rect.left - offsetX;
          let newY = e.clientY - rect.top - offsetY;

          // clamp so box doesn't vanish
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
            if (arr[idx]) {
              arr[idx].xRatio = newX / rect.width;
              arr[idx].yRatio = newY / rect.height;
            }
            return arr;
          });
        }
      });
      document.addEventListener("mouseup", () => {
        isDragging = false;
        measureWidthRatio(box, ann, pageEl);
      });

      // placeholder logic
      box.addEventListener("focus", () => {
        if (box.innerText === "Edit me!") {
          box.innerText = "";
          setAnnotations((prev) => {
            const arr = [...prev];
            if (arr[idx]) arr[idx].text = "";
            return arr;
          });
        }
        measureWidthRatio(box, ann, pageEl);
      });
      // Paste => intercept
      box.addEventListener("paste", (e) => {
        if (!autoFormatPaste) return;
        e.preventDefault();
        const txt = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, txt);
      });
      // On input => store text
      box.addEventListener("input", (e) => {
        setAnnotations((prev) => {
          const arr = [...prev];
          if (arr[idx]) arr[idx].text = box.innerText;
          return arr;
        });
        measureWidthRatio(box, ann, pageEl);
      });
      // If user presses backspace/delete on an empty box => remove
      box.addEventListener("keydown", (e) => {
        if (!pdfLoaded) return;
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          !box.innerText.trim()
        ) {
          e.preventDefault();
          // remove from state
          setAnnotations((prev) => prev.filter((_, i) => i !== idx));
        }
      });

      textLayer.appendChild(box);
      measureWidthRatio(box, ann, pageEl);
    });
  }

  function computeDomFontSize(ann, pageEl) {
    if (!pageSizesRef.current[ann.pageIndex]) return ann.fontSize;
    const { height: unscaledH } = pageSizesRef.current[ann.pageIndex];
    const domH = pageEl.clientHeight;
    const ratio = domH / unscaledH;
    return Math.max(2, ann.fontSize * ratio);
  }

  function measureWidthRatio(el, ann, pageEl) {
    const wPx = el.offsetWidth;
    const pW = pageEl.clientWidth;
    ann.widthRatio = wPx / pW;
  }

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

  /* -------------------- Add Text -------------------- */
  function handleAddText() {
    if (!pdfLoaded) {
      alert("Please load a PDF first!");
      return;
    }
    if (placingAnnotation) return;
    setPlacingAnnotation(true);

    // pointer-events=none => click passes through
    const div = document.createElement("div");
    div.className = "editable-text";
    div.style.pointerEvents = "none";
    div.style.position = "fixed";
    div.style.transform = "translate(-10px, -10px)";
    div.style.borderColor = "#d44";
    div.style.padding = "2px";
    div.style.backgroundColor = hexToRgba(highlightColor, 0.4);
    div.style.color = textColor;
    div.innerText = "Edit me!";

    // approximate the DOM size
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
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
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
          },
        ]);

        // cleanup
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
            const test = currentLine + " " + piece;
            if (font.widthOfTextAtSize(test, fs) > maxW) {
              lines.push(currentLine);
              currentLine = piece;
            } else {
              currentLine = test;
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
      const maxW = ann.widthRatio ? ann.widthRatio * pw : 0.8 * pw;
      const lineSpace = fs * 1.2;

      const rawLines = ann.text.split(/\r?\n/);
      let wrapped = [];
      rawLines.forEach((ln) => {
        wrapped.push(...wrapLine(ln, font, fs, maxW));
      });

      // highlight
      if (ann.highlight.toLowerCase() !== "#ffffff") {
        let widest = 0;
        for (let ln of wrapped) {
          const w = font.widthOfTextAtSize(ln, fs);
          if (w > widest) widest = w;
        }
        const totalH = wrapped.length * lineSpace;
        const hY = topY - totalH;
        page.drawRectangle({
          x: ann.xRatio * pw,
          y: hY,
          width: widest,
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

    const outBytes = await pdfDocLib.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
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

        {/* Zoom Dropdown */}
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

        {/* Text Color */}
        <label style={{ marginLeft: "1rem" }}>Text Color:</label>
        <input
          type="color"
          value={textColor}
          onChange={(e) => setTextColor(e.target.value)}
        />

        {/* Highlight */}
        <label style={{ marginLeft: "1rem" }}>Highlight:</label>
        <input
          type="color"
          value={highlightColor}
          onChange={(e) => setHighlightColor(e.target.value)}
        />

        {/* Text Size (1..100) */}
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
              width: "45px",
              justifyContent: "center",
            }}
          >
            {/* Larger gear icon (width=20, height=20) & center */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 16 16"
              style={{ display: "block", margin: "auto" }}
            >
              <path d="M8 4a.5.5 0 0 0-.5.5v.55a2.5 2.5 0 0 0-1.03.38l-.5-.5a.5.5 0 1 0-.71.71l.5.5A2.5 2.5 0 0 0 5.38 8H4.5a.5.5 0 0 0 0 1h.88a2.5 2.5 0 0 0 .38 1.03l-.5.5a.5.5 0 1 0 .71.71l.5-.5A2.5 2.5 0 0 0 7.5 11.45v.55a.5.5 0 0 0 1 0v-.55a2.5 2.5 0 0 0 1.03-.38l.5.5a.5.5 0 1 0 .71-.71l-.5-.5A2.5 2.5 0 0 0 11.45 9h.55a.5.5 0 0 0 0-1h-.55a2.5 2.5 0 0 0-.38-1.03l.5-.5a.5.5 0 1 0-.71-.71l-.5.5A2.5 2.5 0 0 0 9 5.55v-.55A.5.5 0 0 0 8 4zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
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

      {/* Drag & Drop area */}
      <div id="drop-area">
        <p>
          Drag &amp; Drop PDF Here
          <br />
          or click "Upload PDF"
        </p>
      </div>

      {/* PDF Container */}
      <div ref={pdfContainerRef} id="pdf-container" />

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
          top: 40px;
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
