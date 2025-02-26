"use client";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Script from "next/script";

/* ---------- Helpers for localStorage PDF & annotation storage ---------- */
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/* ---------- Convert #RGB => RGBA for highlight ---------- */
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

export default function Home() {
  /* ---------- Global States ---------- */
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoFormatPaste, setAutoFormatPaste] = useState(true);
  const [saveProgress, setSaveProgress] = useState(true);

  // PDF
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null); // raw PDF data
  const [numPages, setNumPages] = useState(1);

  // Unscaled page sizes
  const pageSizesRef = useRef([]);

  // Annotations
  const [annotations, setAnnotations] = useState([]);

  // Are we placing a brand-new text box?
  const [placingAnnotation, setPlacingAnnotation] = useState(false);

  // Active annotation => reflect in color/highlight/size
  const [activeIndex, setActiveIndex] = useState(null);

  // Container for the PDF pages
  const pdfContainerRef = useRef(null);

  /* ---------- Zoom Input with a Custom Always-Visible Menu ---------- */
  const [zoomValue, setZoomValue] = useState("100%");
  const [zoomScale, setZoomScale] = useState(1.0);
  const [showZoomMenu, setShowZoomMenu] = useState(false);

  // The standard zoom items we always want to show, no filtering
  const zoomItems = [
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

  // handle picking from the custom zoom menu
  function handlePickZoom(item) {
    setZoomValue(item);
    setShowZoomMenu(false);
    parseZoomAndRender(item);
  }

  // handle typed input => parse on blur or Enter
  function handleZoomInputChange(e) {
    setZoomValue(e.target.value);
  }
  function handleZoomInputBlur() {
    // on blur => parse & hide menu
    parseZoomAndRender(zoomValue);
    // slight setTimeout to allow pickZoom click
    setTimeout(() => setShowZoomMenu(false), 150);
  }
  function handleZoomInputFocus() {
    setShowZoomMenu(true);
  }
  function handleZoomInputKey(e) {
    if (e.key === "Enter") {
      parseZoomAndRender(zoomValue);
      setShowZoomMenu(false);
    }
  }

  function parseZoomAndRender(str) {
    const sc = parseZoomValue(str);
    setZoomScale(sc);
    setZoomValue(renderZoomString(sc, str)); // update the input to e.g. "150%" or "1.5"
    renderAllPages(sc);
  }

  function parseZoomValue(str) {
    str = str.trim().toLowerCase();
    if (str === "actual size") return 1.0;
    if (str === "page fit") {
      if (!pageSizesRef.current.length) return 1.0;
      const offset = 200;
      const { height } = pageSizesRef.current[0];
      return Math.max(0.1, (window.innerHeight - offset) / height);
    }
    if (str === "page width") {
      if (!pageSizesRef.current.length) return 1.0;
      const offset = 100;
      const { width } = pageSizesRef.current[0];
      return Math.max(0.1, (window.innerWidth - offset) / width);
    }
    if (str.endsWith("%")) {
      let val = parseFloat(str);
      if (!isNaN(val)) return val / 100;
    } else {
      // maybe numeric
      let val = parseFloat(str);
      if (!isNaN(val)) return val;
    }
    // fallback
    return 1.0;
  }

  function renderZoomString(scale, fallback) {
    // if scale is something standard, show that
    const pct = Math.round(scale * 100);
    if ([50, 75, 100, 125, 150, 200, 300, 400].includes(pct) || scale === 1.0) {
      return pct + "%";
    }
    return String(fallback); // keep user input
  }

  /* ---------- Text Style ---------- */
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffff00");

  /* ---------- Dark Mode on mount ---------- */
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

  /* ---------- Load from localStorage ---------- */
  useEffect(() => {
    const sp = localStorage.getItem("saveProgress");
    if (sp === "false") {
      setSaveProgress(false);
    }
    if (sp !== "false") {
      const b64pdf = localStorage.getItem("pdfBase64");
      const annJSON = localStorage.getItem("annotations");
      if (b64pdf && annJSON) {
        loadSavedPDF(b64pdf, annJSON);
      }
    }
  }, []);

  function loadSavedPDF(b64, annJSON) {
    let annArr = [];
    try {
      annArr = JSON.parse(annJSON);
    } catch {}
    setAnnotations(annArr);

    const ab = base64ToArrayBuffer(b64);
    const bytes = new Uint8Array(ab);
    setPdfBytes(bytes);

    window.pdfjsLib
      .getDocument(bytes)
      .promise.then((doc) => {
        setPdfDoc(doc);
        setPdfLoaded(true);
        setNumPages(doc.numPages);

        const tasks = [];
        for (let i = 1; i <= doc.numPages; i++) {
          tasks.push(doc.getPage(i));
        }
        Promise.all(tasks).then((pages) => {
          const arr = pages.map((p) => {
            const vp = p.getViewport({ scale: 1 });
            return { width: vp.width, height: vp.height };
          });
          pageSizesRef.current = arr;

          setZoomValue("100%");
          setZoomScale(1.0);
          renderAllPages(1.0);
        });
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!saveProgress) return;
    if (!pdfBytes) return;
    localStorage.setItem("pdfBase64", arrayBufferToBase64(pdfBytes));
    localStorage.setItem("annotations", JSON.stringify(annotations));
  }, [pdfBytes, annotations, saveProgress]);

  /* ---------- handleFileChange => load PDF from user ---------- */
  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return;
    setAnnotations([]);

    const reader = new FileReader();
    reader.onload = async () => {
      const bytes = new Uint8Array(reader.result);
      setPdfBytes(bytes);

      const doc = await window.pdfjsLib.getDocument(bytes).promise;
      setPdfDoc(doc);
      setPdfLoaded(true);
      setNumPages(doc.numPages);

      const arr = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        arr.push({ width: vp.width, height: vp.height });
      }
      pageSizesRef.current = arr;

      setZoomValue("100%");
      setZoomScale(1.0);
      renderAllPages(1.0);
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- Render PDF (Continuous) ---------- */
  async function renderAllPages(scale) {
    if (!pdfDoc) return;
    const container = pdfContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const vp = page.getViewport({ scale });
      const width = vp.width;
      const height = vp.height;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
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

      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const textLayer = document.createElement("div");
      textLayer.className = "text-layer";
      pageDiv.appendChild(textLayer);
    }
    applyAnnotationsAll();
  }

  function applyAnnotationsAll() {
    const container = pdfContainerRef.current;
    if (!container) return;
    const pages = container.querySelectorAll(".pdf-page");
    pages.forEach((p) => {
      const t = p.querySelector(".text-layer");
      if (t) t.innerHTML = "";
    });

    annotations.forEach((ann, idx) => {
      if (ann.pageIndex >= pages.length) return;
      const pageEl = pages[ann.pageIndex];
      const textLayer = pageEl.querySelector(".text-layer");
      if (!textLayer) return;
      // create the box
      const box = createAnnotationBox(ann, idx, pageEl);
      textLayer.appendChild(box);
    });
  }

  function createAnnotationBox(ann, idx, pageEl) {
    const dpr = window.devicePixelRatio || 1;
    // Compute DOM font size from PDF units:
    const ratio =
      pageEl.clientHeight / (pageSizesRef.current[ann.pageIndex]?.height || 1);
    const domFS = Math.max(2, ann.fontSize * ratio);

    const xPx = ann.xRatio * pageEl.clientWidth;
    const yPx = ann.yRatio * pageEl.clientHeight;

    const box = document.createElement("div");
    box.className = "editable-text";
    box.style.left = xPx + "px";
    box.style.top = yPx + "px";
    box.style.fontSize = domFS + "px";
    box.style.color = ann.color;
    box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
    box.style.overflow = "hidden"; // no scroll bar
    box.contentEditable = pdfLoaded ? "true" : "false";
    box.setAttribute("data-annindex", idx.toString());
    box.innerText = ann.text;

    if (ann.widthRatio) {
      box.style.width = ann.widthRatio * pageEl.clientWidth + "px";
    }
    if (ann.heightRatio) {
      box.style.height = ann.heightRatio * pageEl.clientHeight + "px";
    }

    // DRAG
    let isDragging = false;
    let offsetX = 0,
      offsetY = 0;
    box.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("resizer")) return; // skip if user clicked resizer
      if (!pdfLoaded) return;
      isDragging = true;
      const r = box.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
      e.stopPropagation();
      // set active
      setActiveIndex(idx);
      setFontSize(ann.fontSize);
      setTextColor(ann.color);
      setHighlightColor(ann.highlight);
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const rect = pageEl.getBoundingClientRect();
      let newX = e.clientX - rect.left - offsetX;
      let newY = e.clientY - rect.top - offsetY;
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
    });
    document.addEventListener("mouseup", () => {
      isDragging = false;
      // measure width ratio
      setAnnotations((prev) => {
        const arr = [...prev];
        if (arr[idx]) {
          const wPx = box.offsetWidth;
          const pW = pageEl.clientWidth;
          arr[idx].widthRatio = wPx / pW;
        }
        return arr;
      });
    });

    // focus => remove placeholder
    box.addEventListener("focus", () => {
      if (box.innerText === "Edit me!") {
        box.innerText = "";
        setAnnotations((prev) => {
          const arr = [...prev];
          if (arr[idx]) arr[idx].text = "";
          return arr;
        });
      }
    });
    // paste => autoFormat
    box.addEventListener("paste", (e) => {
      if (!autoFormatPaste) return;
      e.preventDefault();
      const txt = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, txt);
    });
    // input => store text
    box.addEventListener("input", () => {
      setAnnotations((prev) => {
        const arr = [...prev];
        if (arr[idx]) arr[idx].text = box.innerText;
        return arr;
      });
    });
    // if empty => remove
    box.addEventListener("keydown", (e) => {
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !box.innerText.trim()
      ) {
        e.preventDefault();
        setAnnotations((prev) => prev.filter((_, i) => i !== idx));
      }
    });

    // Resizer
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
      if (newW < 30) newW = 30;
      if (newH < 20) newH = 20;

      const rect = pageEl.getBoundingClientRect();
      const left = box.offsetLeft;
      const top = box.offsetTop;
      if (left + newW > rect.width) newW = rect.width - left;
      if (top + newH > rect.height) newH = rect.height - top;

      box.style.width = newW + "px";
      box.style.height = newH + "px";
    });
    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        setAnnotations((prev) => {
          const arr = [...prev];
          if (arr[idx]) {
            const rect = pageEl.getBoundingClientRect();
            arr[idx].widthRatio = box.offsetWidth / rect.width;
            arr[idx].heightRatio = box.offsetHeight / rect.height;
          }
          return arr;
        });
      }
    });

    return box;
  }

  /* ---------- Add Text Box => immediate appear ---------- */
  function handleAddTextBox() {
    if (!pdfLoaded) {
      alert("Please load a PDF first!");
      return;
    }
    if (placingAnnotation) return;
    setPlacingAnnotation(true);

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
    div.style.overflow = "hidden";

    // approximate
    let approximate = Math.min(100, fontSize);
    if (pageSizesRef.current.length > 0) {
      const firstPageEl = pdfContainerRef.current?.querySelector(".pdf-page");
      if (firstPageEl) {
        const ratio =
          firstPageEl.clientHeight / pageSizesRef.current[0].height || 1.0;
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
        const x = e.clientX - rect.left - 10;
        const y = e.clientY - rect.top - 10;

        const allPages = [
          ...pdfContainerRef.current.querySelectorAll(".pdf-page"),
        ];
        const pIndex = allPages.indexOf(pageEl);

        // new annotation
        const newAnn = {
          pageIndex: pIndex,
          xRatio: x / rect.width,
          yRatio: y / rect.height,
          text: "Edit me!",
          fontSize: Math.min(100, fontSize),
          color: textColor,
          highlight: highlightColor,
          widthRatio: 0,
          heightRatio: 0,
        };
        setAnnotations((prev) => [...prev, newAnn]);

        // also create DOM node so it appears now
        const idx = annotations.length;
        const textLayer = pageEl.querySelector(".text-layer");
        if (textLayer) {
          const box = createAnnotationBox(newAnn, idx, pageEl);
          textLayer.appendChild(box);
        }

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("click", onClick);
        div.remove();
        setPlacingAnnotation(false);
      }
    };
    document.addEventListener("click", onClick);
  }

  /* ---------- Download PDF ---------- */
  async function handleDownload() {
    if (!pdfLoaded || !pdfBytes) {
      alert("No PDF loaded!");
      return;
    }
    await doDownloadPDF();
  }

  async function doDownloadPDF() {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdfDocLib = await PDFDocument.load(pdfBytes);
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
    for (let ann of annotations) {
      if (!pages[ann.pageIndex]) continue;
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

      if (ann.highlight.toLowerCase() !== "#ffffff") {
        let maxWidth = 0;
        for (let ln of wrapped) {
          const w = font.widthOfTextAtSize(ln, fs);
          if (w > maxWidth) maxWidth = w;
        }
        const totalH = wrapped.length * lineSpace;
        const highlightY = topY - totalH;
        page.drawRectangle({
          x: ann.xRatio * pw,
          y: highlightY,
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
    }

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

        {/* Single Zoom Input (no label) + a custom always-visible dropdown. */}
        <div style={{ position: "relative", marginLeft: "1rem" }}>
          <input
            className="zoom-input"
            type="text"
            style={{ width: "100px", textAlign: "center" }}
            value={zoomValue}
            onChange={handleZoomInputChange}
            onFocus={handleZoomInputFocus}
            onBlur={handleZoomInputBlur}
            onKeyDown={handleZoomInputKey}
            autoComplete="off"
          />
          {showZoomMenu && (
            <div className="zoom-menu">
              {zoomItems.map((item) => (
                <div
                  key={item}
                  className="zoom-item"
                  onMouseDown={() => handlePickZoom(item)}
                >
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* + Text */}
        <button onClick={handleAddTextBox} className="button secondary">
          + Text
        </button>

        {/* Colors / Font */}
        <label style={{ marginLeft: "1rem" }}>Color:</label>
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
        <label style={{ marginLeft: "1rem" }}>Text Size:</label>
        <input
          type="number"
          min={1}
          max={200}
          step={1}
          value={fontSize}
          onChange={(e) => {
            let val = parseFloat(e.target.value) || 1;
            if (val > 200) val = 200;
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
            {/* Larger gear => 36x36 */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="36"
              height="36"
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
                <div className="settings-item">
                  <label>Save Progress</label>
                  <input
                    type="checkbox"
                    checked={saveProgress}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSaveProgress(val);
                      localStorage.setItem("saveProgress", String(val));
                    }}
                  />
                </div>
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Drag area + PDF container */}
      <div id="drop-area">
        <p>
          Drag &amp; Drop PDF Here
          <br />
          or click "Upload PDF"
        </p>
      </div>
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
          gap: 8px;
          padding: 8px 16px;
          backdrop-filter: blur(10px);
          background: var(--toolbar-bg);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        #drop-area {
          border: 2px dashed #bbb;
          margin: 60px 20px 20px;
          padding: 20px;
          text-align: center;
          border-radius: 6px;
        }
        #pdf-container {
          display: block;
          margin: 0 auto;
          max-width: 1000px;
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
          overflow: hidden; /* no scroll bar */
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
          padding: 6px 12px;
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

        /* Our custom zoom menu styles */
        .zoom-input {
          padding: 4px;
          border: 1px solid #888;
          border-radius: 4px;
        }
        .zoom-menu {
          position: absolute;
          top: 36px; /* below the input */
          left: 0;
          width: 120px;
          background: var(--toolbar-bg);
          backdrop-filter: blur(10px);
          border: 1px solid #888;
          border-radius: 4px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          max-height: 200px;
          overflow-y: auto;
          z-index: 9999;
        }
        .zoom-item {
          padding: 6px 8px;
          cursor: pointer;
        }
        .zoom-item:hover {
          background: #ccc;
        }
      `}</style>
    </>
  );
}
