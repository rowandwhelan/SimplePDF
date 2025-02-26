"use client";
import Head from "next/head";
import Script from "next/script";

export default function Home() {
  return (
    <>
      <Head>
        <meta charSet="UTF-8" />
        <title>Modern PDF Editor</title>
      </Head>

      {/* Global styles */}
      <style jsx global>{`
        body {
          font-family: sans-serif;
          margin: 0;
          padding: 0;
          background: #f0f2f5;
        }
        /* Fixed toolbar with frosted glass effect */
        #toolbar {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          z-index: 1000;
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.3);
          padding: 10px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        #toolbar * {
          margin: 5px;
        }
        #toolbar button {
          border: none;
          border-radius: 5px;
          background: linear-gradient(90deg, #6a11cb, #2575fc);
          color: #fff;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 0.3s;
        }
        #toolbar button:hover {
          background: linear-gradient(90deg, #2575fc, #6a11cb);
        }
        #toolbar input,
        #toolbar select {
          padding: 5px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        /* Provide spacing so the content isn’t hidden behind the fixed toolbar */
        #content {
          padding-top: 100px;
        }
        /* Drag and drop area */
        #drop-area {
          border: 2px dashed #bbb;
          margin: 20px;
          padding: 50px;
          text-align: center;
          color: #777;
          background: #fff;
          border-radius: 10px;
        }
        /* PDF container and page styling */
        #pdf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 40px;
          transition: transform 0.3s;
          transform-origin: top center;
        }
        .pdf-page {
          position: relative;
          margin: 20px 0;
          background: #fff;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        /* Overlay for text editing */
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
          background: transparent;
          border: 1px dashed #ccc;
          padding: 2px 4px;
          min-width: 50px;
          min-height: 20px;
          cursor: move;
          outline: none;
        }
      `}</style>

      {/* Toolbar */}
      <div id="toolbar">
        <div id="file-controls">
          <label htmlFor="file-input">Upload PDF:</label>
          <input type="file" id="file-input" accept="application/pdf" />
          <button id="add-text">Add Text</button>
          <button id="download-pdf">Download PDF</button>
        </div>
        <div id="view-controls">
          <label htmlFor="zoom-slider">Zoom:</label>
          <input
            type="range"
            id="zoom-slider"
            min="0.5"
            max="3"
            step="0.1"
            defaultValue="1.5"
          />
          <label htmlFor="page-size">Page Size:</label>
          <select id="page-size">
            <option value="original">Original</option>
            <option value="fullwidth">Full Width</option>
            <option value="a4">A4 (595 x 842)</option>
            <option value="letter">Letter (612 x 792)</option>
          </select>
          <label htmlFor="font-size">Font Size:</label>
          <select id="font-size">
            <option value="14">14px</option>
            <option value="18">18px</option>
            <option value="24">24px</option>
            <option value="32">32px</option>
          </select>
          <label htmlFor="text-color">Text Color:</label>
          <input type="color" id="text-color" defaultValue="#000000" />
          <label htmlFor="highlight-color">Highlight:</label>
          <input
            type="color"
            id="highlight-color"
            defaultValue="#ffff00"
            title="Highlight Color"
          />
        </div>
      </div>

      <div id="content">
        {/* Drag & drop area */}
        <div id="drop-area">Drag & Drop PDF here</div>

        {/* Container where PDF pages will be rendered */}
        <div id="pdf-container"></div>
      </div>

      {/* Load PDF.js */}
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.min.js"
        strategy="beforeInteractive"
      />

      {/* Load pdf-lib */}
      <Script
        src="https://unpkg.com/pdf-lib/dist/pdf-lib.min.js"
        strategy="beforeInteractive"
      />

      {/* PDF Editor Script */}
      <Script id="pdf-editor" strategy="lazyOnload">
        {`
          let pdfDoc = null;
          let originalPDFBytes = null;
          let currentZoom = 1.5;

          const fileInput = document.getElementById('file-input');
          const dropArea = document.getElementById('drop-area');
          const pdfContainer = document.getElementById('pdf-container');
          const addTextBtn = document.getElementById('add-text');
          const downloadBtn = document.getElementById('download-pdf');
          const zoomSlider = document.getElementById('zoom-slider');
          const pageSizeSelect = document.getElementById('page-size');
          const fontSizeSelect = document.getElementById('font-size');
          const textColorInput = document.getElementById('text-color');
          const highlightColorInput = document.getElementById('highlight-color');

          // --- Drag and drop functionality ---
          ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
              e.preventDefault();
              dropArea.style.background = '#e9e9e9';
            }, false);
          });
          ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
              e.preventDefault();
              dropArea.style.background = '';
            }, false);
          });
          dropArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files[0] && files[0].type === 'application/pdf') {
              loadPDF(files[0]);
            }
          });
          fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.type === 'application/pdf') {
              loadPDF(file);
            }
          });

          // --- Load and render PDF using PDF.js ---
          async function loadPDF(file) {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
              originalPDFBytes = this.result;
              const typedarray = new Uint8Array(originalPDFBytes);
              pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
              renderPDF();
            }
            fileReader.readAsArrayBuffer(file);
          }

          async function renderPDF() {
            pdfContainer.innerHTML = '';
            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
              const page = await pdfDoc.getPage(pageNum);
              const viewport = page.getViewport({ scale: currentZoom });
              const pageContainer = document.createElement('div');
              pageContainer.className = 'pdf-page';
              pageContainer.style.width = viewport.width + 'px';
              pageContainer.style.height = viewport.height + 'px';

              // Create canvas for PDF page rendering
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              pageContainer.appendChild(canvas);

              const context = canvas.getContext('2d');
              await page.render({ canvasContext: context, viewport: viewport }).promise;
              
              // Add transparent text layer overlay
              const textLayer = document.createElement('div');
              textLayer.className = 'text-layer';
              pageContainer.appendChild(textLayer);

              pdfContainer.appendChild(pageContainer);
            }
          }

          // --- Add editable text overlay ---
          addTextBtn.addEventListener('click', () => {
            // For simplicity, add text to the first page only
            const firstPage = pdfContainer.querySelector('.pdf-page');
            if (!firstPage) return alert('Please load a PDF first!');

            const editable = document.createElement('div');
            editable.className = 'editable-text';
            editable.contentEditable = true;
            editable.style.top = '10px';
            editable.style.left = '10px';
            editable.style.fontSize = fontSizeSelect.value + 'px';
            editable.style.color = textColorInput.value;
            editable.style.backgroundColor = highlightColorInput.value;
            editable.innerText = 'Edit me';

            // Simple dragging functionality
            let isDragging = false;
            let offsetX, offsetY;
            editable.addEventListener('mousedown', (e) => {
              isDragging = true;
              offsetX = e.offsetX;
              offsetY = e.offsetY;
              e.stopPropagation();
            });
            document.addEventListener('mousemove', (e) => {
              if (isDragging) {
                const rect = firstPage.getBoundingClientRect();
                editable.style.left = (e.clientX - rect.left - offsetX) + 'px';
                editable.style.top = (e.clientY - rect.top - offsetY) + 'px';
              }
            });
            document.addEventListener('mouseup', () => {
              isDragging = false;
            });

            // Update style on toolbar changes
            fontSizeSelect.addEventListener('change', () => {
              editable.style.fontSize = fontSizeSelect.value + 'px';
            });
            textColorInput.addEventListener('change', () => {
              editable.style.color = textColorInput.value;
            });
            highlightColorInput.addEventListener('change', () => {
              editable.style.backgroundColor = highlightColorInput.value;
            });

            // Append editable text element to the text layer
            firstPage.querySelector('.text-layer').appendChild(editable);
          });

          // --- Zoom functionality ---
          zoomSlider.addEventListener('input', () => {
            currentZoom = parseFloat(zoomSlider.value);
            // Apply CSS transform for a quick zoom effect
            pdfContainer.style.transform = 'scale(' + currentZoom + ')';
          });

          // --- Page size adjustments ---
          pageSizeSelect.addEventListener('change', () => {
            const value = pageSizeSelect.value;
            // For simplicity, adjust the container width for preset sizes
            if (value === 'fullwidth') {
              pdfContainer.style.width = window.innerWidth + 'px';
            } else if (value === 'a4') {
              pdfContainer.style.width = '595px';
            } else if (value === 'letter') {
              pdfContainer.style.width = '612px';
            } else {
              pdfContainer.style.width = 'auto';
            }
          });

          // --- Download PDF functionality using pdf-lib ---
          downloadBtn.addEventListener('click', async () => {
            if (!originalPDFBytes) return alert('No PDF loaded!');
            const { PDFDocument, rgb } = PDFLib;
            const pdfDocLib = await PDFDocument.load(originalPDFBytes);
            const pages = pdfContainer.querySelectorAll('.pdf-page');
            
            // Iterate over each page and add text overlays
            pages.forEach((pageElement, index) => {
              const overlays = pageElement.querySelectorAll('.editable-text');
              if (overlays.length === 0) return;
              const pdfPage = pdfDocLib.getPage(index);
              const { width, height } = pdfPage.getSize();

              overlays.forEach(overlay => {
                const text = overlay.innerText;
                const style = window.getComputedStyle(overlay);
                const fontSize = parseFloat(style.fontSize);
                const textColor = style.color; // expected in "rgb(r, g, b)" format

                // Helper to convert rgb/hex to pdf-lib's rgb object
                function parseRGB(rgbString) {
                  const result = rgbString.match(/\\d+/g);
                  return result
                    ? {
                        r: parseInt(result[0], 10) / 255,
                        g: parseInt(result[1], 10) / 255,
                        b: parseInt(result[2], 10) / 255
                      }
                    : { r: 0, g: 0, b: 0 };
                }
                const rgbColor = parseRGB(textColor);
                
                // Get overlay position relative to the PDF page element
                const overlayRect = overlay.getBoundingClientRect();
                const pageRect = pageElement.getBoundingClientRect();
                // Convert position: our origin is top-left; PDF-lib uses bottom-left.
                const x = overlayRect.left - pageRect.left;
                const y = height - (overlayRect.top - pageRect.top) - fontSize;
                
                // Draw a highlight rectangle if needed
                const highlightColor = style.backgroundColor;
                const parsedHighlight = parseRGB(highlightColor);
                const measureCanvas = document.createElement("canvas");
                const measureCtx = measureCanvas.getContext("2d");
                measureCtx.font = fontSize + "px sans-serif";
                const textWidth = measureCtx.measureText(text).width;
                if (
                  highlightColor &&
                  highlightColor !== "rgba(0, 0, 0, 0)" &&
                  highlightColor !== "transparent"
                ) {
                  pdfPage.drawRectangle({
                    x: x,
                    y: y - fontSize * 0.2,
                    width: textWidth,
                    height: fontSize * 1.2,
                    color: rgb(parsedHighlight.r, parsedHighlight.g, parsedHighlight.b),
                  });
                }
                
                // Draw the text overlay on the PDF
                pdfPage.drawText(text, {
                  x: x,
                  y: y,
                  size: fontSize,
                  color: rgb(rgbColor.r, rgbColor.g, rgbColor.b)
                });
              });
            });
            
            const pdfBytes = await pdfDocLib.save();
            const blob = new Blob([pdfBytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "edited.pdf";
            a.click();
            URL.revokeObjectURL(url);
          });
        `}
      </Script>
    </>
  );
}
