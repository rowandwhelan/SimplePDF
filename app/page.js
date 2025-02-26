"use client";
import { useState, useEffect } from "react";
import Head from "next/head";
import Script from "next/script";

export default function Home() {
  /* -------------------- Dark/Light Mode -------------------- */
  const [darkMode, setDarkMode] = useState(false);

  // Detect system default on mount
  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setDarkMode(true);
    }
  }, []);

  // Dynamically update body class whenever darkMode changes
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkMode]);

  /* -------------------- PDF Handling -------------------- */
  useEffect(() => {
    let pdfDoc = null;
    let originalPdfBytes = null;
    let placingAnnotation = false;
    let tempEl = null; // The "follow cursor" annotation element
    let moveHandler = null;
    let clickHandler = null;

    // We store all annotations here
    // annotation = {
    //   pageIndex, xRatio, yRatio, text, fontSizePx, fontSizeRatio,
    //   color, highlight
    // }
    const annotations = [];

    // Grab references to important DOM elements
    const fileInput = document.getElementById("file-input");
    const dropArea = document.getElementById("drop-area");
    const pdfContainer = document.getElementById("pdf-container");

    // Toolbar elements
    const addTextBtn = document.getElementById("add-text");
    const zoomInput = document.getElementById("zoom");
    const pageSizeSelect = document.getElementById("page-size");
    const fontSizeSelect = document.getElementById("font-size");
    const textColorInput = document.getElementById("text-color");
    const highlightColorInput = document.getElementById("highlight-color");
    const downloadBtn = document.getElementById("download-pdf");

    /* ============== Drag-and-Drop & File Input ============== */
    ["dragenter", "dragover"].forEach((evtName) => {
      dropArea.addEventListener(
        evtName,
        (e) => {
          e.preventDefault();
          dropArea.classList.add("dragover");
        },
        false
      );
    });
    ["dragleave", "drop"].forEach((evtName) => {
      dropArea.addEventListener(
        evtName,
        (e) => {
          e.preventDefault();
          dropArea.classList.remove("dragover");
        },
        false
      );
    });
    dropArea.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files[0] && files[0].type === "application/pdf") {
        loadPDF(files[0]);
      }
    });
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file && file.type === "application/pdf") {
        loadPDF(file);
      }
    });

    /* ============== Load & Render PDF using PDF.js ============== */
    async function loadPDF(file) {
      const reader = new FileReader();
      reader.onload = async function () {
        originalPdfBytes = this.result;
        pdfDoc = await window.pdfjsLib.getDocument(
          new Uint8Array(originalPdfBytes)
        ).promise;
        renderPDF();
      };
      reader.readAsArrayBuffer(file);
    }

    async function renderPDF() {
      pdfContainer.innerHTML = "";
      const zoomVal = parseFloat(zoomInput.value) || 1.5;

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: zoomVal });

        const pageContainer = document.createElement("div");
        pageContainer.className = "pdf-page";
        pageContainer.style.width = viewport.width + "px";
        pageContainer.style.height = viewport.height + "px";

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        pageContainer.appendChild(canvas);

        const context = canvas.getContext("2d");
        await page.render({ canvasContext: context, viewport: viewport })
          .promise;

        const textLayer = document.createElement("div");
        textLayer.className = "text-layer";
        pageContainer.appendChild(textLayer);

        pdfContainer.appendChild(pageContainer);
      }
      applyAnnotations();
      updatePageSizes();
    }

    /* ============== Re-draw Annotations ============== */
    function applyAnnotations() {
      // Clear all existing annotation boxes
      document.querySelectorAll(".pdf-page").forEach((pageEl) => {
        pageEl.querySelector(".text-layer").innerHTML = "";
      });

      annotations.forEach((ann) => {
        const pageEl = document.querySelectorAll(".pdf-page")[ann.pageIndex];
        if (!pageEl) return;

        const textLayer = pageEl.querySelector(".text-layer");
        const width = pageEl.clientWidth;
        const height = pageEl.clientHeight;

        // Convert ratio to absolute coords
        const absX = ann.xRatio * width;
        const absY = ann.yRatio * height;

        // Convert ratio-based font size
        const calcFontSize = ann.fontSizeRatio * height;
        // => This ensures the text scales with the page's height
        // (You could also scale based on width, or a mix)

        const editable = document.createElement("div");
        editable.className = "editable-text";
        editable.contentEditable = true;
        editable.style.left = absX + "px";
        editable.style.top = absY + "px";
        editable.style.fontSize = calcFontSize + "px";
        editable.style.color = ann.color;
        editable.style.backgroundColor = ann.highlight;
        editable.innerText = ann.text;

        // Keep annotation text in sync
        editable.addEventListener("input", () => {
          ann.text = editable.innerText;
        });

        // Draggable
        let isDragging = false;
        let offsetX = 0,
          offsetY = 0;
        editable.addEventListener("mousedown", (e) => {
          isDragging = true;
          const rect = editable.getBoundingClientRect();
          offsetX = e.clientX - rect.left;
          offsetY = e.clientY - rect.top;
          e.stopPropagation();
        });
        document.addEventListener("mousemove", (e) => {
          if (isDragging) {
            const pgRect = pageEl.getBoundingClientRect();
            const newX = e.clientX - pgRect.left - offsetX;
            const newY = e.clientY - pgRect.top - offsetY;
            editable.style.left = newX + "px";
            editable.style.top = newY + "px";
            // Update annotation ratios
            ann.xRatio = newX / pgRect.width;
            ann.yRatio = newY / pgRect.height;
          }
        });
        document.addEventListener("mouseup", () => {
          isDragging = false;
        });

        textLayer.appendChild(editable);
      });
    }

    /* ============== Page Size & Re-apply Annotations ============== */
    function updatePageSizes() {
      const preset = pageSizeSelect.value;
      const pages = document.querySelectorAll(".pdf-page");

      pages.forEach((pageEl) => {
        // Reset so each new preset is applied cleanly
        pageEl.style.width = "";
        pageEl.style.height = "";

        if (preset === "a4") {
          pageEl.style.width = "794px";
          pageEl.style.height = "1123px";
        } else if (preset === "letter") {
          pageEl.style.width = "816px";
          pageEl.style.height = "1056px";
        } else if (preset === "full-width") {
          pageEl.style.width = "calc(100% - 40px)";
          pageEl.style.height = "auto";
        } else if (preset === "full-height") {
          pageEl.style.width = "auto";
          pageEl.style.height = "100vh";
        }
      });
      // Re-draw
      applyAnnotations();
    }
    pageSizeSelect.addEventListener("change", updatePageSizes);

    /* ============== "Add Text" -> Follow Cursor ============== */
    addTextBtn.addEventListener("click", () => {
      if (placingAnnotation) return;
      placingAnnotation = true;

      // Create a temp annotation element that follows the mouse
      tempEl = document.createElement("div");
      tempEl.className = "editable-text";
      tempEl.contentEditable = true;
      tempEl.style.position = "fixed";
      tempEl.style.fontSize = fontSizeSelect.value;
      tempEl.style.color = textColorInput.value;
      tempEl.style.backgroundColor = highlightColorInput.value;
      tempEl.innerText = "Edit me";
      tempEl.style.borderColor = "#d44"; // visually indicates placing mode
      document.body.appendChild(tempEl);

      // Move Handler
      moveHandler = (e) => {
        tempEl.style.left = e.clientX + "px";
        tempEl.style.top = e.clientY + "px";
      };
      document.addEventListener("mousemove", moveHandler);

      // Click Handler: deposit on PDF page
      clickHandler = (e) => {
        const pageEl = e.target.closest(".pdf-page");
        if (pageEl) {
          const pages = Array.from(document.querySelectorAll(".pdf-page"));
          const pageIndex = pages.indexOf(pageEl);
          const pgRect = pageEl.getBoundingClientRect();
          const x = e.clientX - pgRect.left;
          const y = e.clientY - pgRect.top;

          // Convert user-chosen font size (e.g. "14px") to ratio
          const baseFontPx = parseFloat(fontSizeSelect.value);
          // We use pageEl's height to derive a ratio
          const fontSizeRatio = baseFontPx / pgRect.height;

          // Add new annotation
          annotations.push({
            pageIndex,
            xRatio: x / pgRect.width,
            yRatio: y / pgRect.height,
            text: "Edit me",
            fontSizePx: baseFontPx, // The base chosen by user
            fontSizeRatio,
            color: textColorInput.value,
            highlight: highlightColorInput.value,
          });

          // Cleanup
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("click", clickHandler);
          tempEl.remove();
          tempEl = null;
          placingAnnotation = false;

          // Re-draw everything
          applyAnnotations();

          // Focus the new annotation automatically
          setTimeout(() => {
            const lastAnn = annotations[annotations.length - 1];
            const pageElem =
              document.querySelectorAll(".pdf-page")[lastAnn.pageIndex];
            if (!pageElem) return;
            const textLayer = pageElem.querySelector(".text-layer");
            // The new annotation should be the last child
            const newEl = textLayer.lastElementChild;
            if (newEl) newEl.focus();
          }, 0);
        }
      };
      document.addEventListener("click", clickHandler);
    });

    /* ============== Zoom Without Losing Annotations ============== */
    zoomInput.addEventListener("change", () => {
      if (pdfDoc) {
        renderPDF();
      }
    });

    /* ============== Download PDF with pdf-lib ============== */
    downloadBtn.addEventListener("click", async () => {
      if (!originalPdfBytes) return alert("Please load a PDF first!");
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const pdfDocLib = await PDFDocument.load(originalPdfBytes);
      const font = await pdfDocLib.embedFont(StandardFonts.Helvetica);

      // For each annotation...
      for (const ann of annotations) {
        const page = pdfDocLib.getPages()[ann.pageIndex];
        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();

        // Convert ratio-based coords: (0,0) in PDF is bottom-left,
        // while we measure from top-left in the DOM
        const absX = ann.xRatio * pageWidth;
        const absY = (1 - ann.yRatio) * pageHeight - parseFloat(ann.fontSizePx);

        // Convert hex color to pdf-lib's rgb
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

        // Draw the text with the *base* font size the user selected
        page.drawText(ann.text, {
          x: absX,
          y: absY,
          size: parseFloat(ann.fontSizePx),
          font,
          color: hexToRgb(ann.color),
        });
      }

      const pdfBytes = await pdfDocLib.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "edited.pdf";
      link.click();
    });
  }, []);

  return (
    <>
      <Head>
        <title>Ultramodern PDF Editor</title>
      </Head>

      {/* Toolbar */}
      <div id="toolbar">
        <div className="toolbar-section">
          <label htmlFor="file-input" className="button primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
              style={{ marginRight: "5px" }}
            >
              <path d="M.5 9.9a.5.5 0 0 1 .5-.5h2v-4a1 1 0 0 1 1-1h3.5a.5.5 0 0 1 0 1H4v4h2.5a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5Z" />
              <path d="M2.5 11h1v4h-1v-4Zm9-9a.5.5 0 0 1 .5.5v5.379l.53-.53a.5.5 0 0 1 .708.708l-1.5 1.5a.499.499 0 0 1-.384.146.517.517 0 0 1-.068.005.5.5 0 0 1-.354-.146l-1.5-1.5a.5.5 0 1 1 .708-.708l.53.53V2.5a.5.5 0 0 1 .5-.5Z" />
            </svg>
            Upload PDF
          </label>
          <input type="file" id="file-input" accept="application/pdf" />
        </div>

        <button id="add-text" className="button secondary">
          + Text
        </button>

        <div className="toolbar-section">
          <label htmlFor="zoom">Zoom:</label>
          <input
            type="number"
            id="zoom"
            defaultValue="1.5"
            min="0.5"
            max="5"
            step="0.1"
          />
        </div>

        <div className="toolbar-section">
          <label htmlFor="page-size">Page Size:</label>
          <select id="page-size">
            <option value="default">Default</option>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
            <option value="full-width">Full Width</option>
            <option value="full-height">Full Height</option>
          </select>
        </div>

        <div className="toolbar-section">
          <label htmlFor="font-size">Text Size:</label>
          <select id="font-size">
            <option value="14px">14px</option>
            <option value="18px">18px</option>
            <option value="24px">24px</option>
            <option value="32px">32px</option>
          </select>
        </div>

        <div className="toolbar-section">
          <label htmlFor="text-color">Text Color:</label>
          <input type="color" id="text-color" defaultValue="#000000" />
        </div>

        <div className="toolbar-section">
          <label htmlFor="highlight-color">Highlight:</label>
          <input type="color" id="highlight-color" defaultValue="#ffff00" />
        </div>

        <button id="download-pdf" className="button primary">
          Download PDF
        </button>

        <button
          className="button toggle-mode"
          onClick={() => setDarkMode((d) => !d)}
          title="Toggle dark/light mode"
        >
          {darkMode ? "Light Mode" : "Dark Mode"}
        </button>
      </div>

      {/* Drop Area */}
      <div id="drop-area">
        <p>
          Drag & Drop PDF Here
          <br />
          or Click 'Upload PDF'
        </p>
      </div>

      {/* PDF Container */}
      <div id="pdf-container"></div>

      {/* PDF.js & pdf-lib via CDN */}
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.min.js"
        strategy="beforeInteractive"
      />
      <Script
        src="https://unpkg.com/pdf-lib/dist/pdf-lib.min.js"
        strategy="beforeInteractive"
      />

      {/* Styles */}
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

        /* Toolbar */
        #toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 999;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 10px 20px;
          backdrop-filter: blur(10px);
          background: var(--toolbar-bg);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        #toolbar label {
          margin-right: 5px;
          color: inherit;
        }
        #toolbar input[type="file"] {
          display: none;
        }

        /* Buttons */
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
        .button:hover {
          filter: brightness(0.9);
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
        .toggle-mode {
          margin-left: auto;
        }

        .toolbar-section {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #toolbar input[type="number"],
        #toolbar select,
        #toolbar input[type="color"] {
          font-size: 14px;
          padding: 4px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: #fff;
          color: #333;
        }
        body.dark #toolbar input[type="number"],
        body.dark #toolbar select,
        body.dark #toolbar input[type="color"] {
          background: #444;
          color: #eee;
          border-color: #666;
        }

        /* Drop Area */
        #drop-area {
          border: 2px dashed #bbb;
          margin: 80px 20px 20px; /* top margin for toolbar space */
          padding: 40px;
          text-align: center;
          border-radius: 6px;
          transition: background 0.3s ease;
        }
        #drop-area p {
          margin: 0;
          font-size: 16px;
        }
        #drop-area.dragover {
          background: rgba(33, 150, 243, 0.1);
          border-color: var(--accent-color);
        }

        /* PDF Container and Pages */
        #pdf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-bottom: 40px;
        }
        .pdf-page {
          position: relative;
          margin: 20px 0;
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
        }

        /* Extra spacing to ensure bottom content isn't hidden */
        body {
          padding-bottom: 100px;
        }
      `}</style>
    </>
  );
}
