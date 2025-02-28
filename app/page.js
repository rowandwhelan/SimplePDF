"use client";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Script from "next/script";

/* ---------- LocalStorage Helpers ---------- */
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

/* ---------- Hex to RGBA Converter ---------- */
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
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoFormatPaste, setAutoFormatPaste] = useState(true);
  const [saveProgress, setSaveProgress] = useState(true);

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [numPages, setNumPages] = useState(1);

  // Default text style
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffffff");

  const pageSizesRef = useRef([]);
  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  const annotationIdCounter = useRef(0);

  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [isPlacingAnnotation, setIsPlacingAnnotation] = useState(false);

  const pdfContainerRef = useRef(null);
  const currentPdfName = useRef(null);

  // Zoom
  const [zoomValue, setZoomValue] = useState("100%");
  const [zoomScale, setZoomScale] = useState(1.0);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
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

  const gearRef = useRef(null);
  const settingsRef = useRef(null);

  function parseZoomValue(str) {
    str = str.trim().toLowerCase();
    if (str === "actual size") return 1.0;
    if (str === "page fit") {
      if (!pageSizesRef.current.length) return 1.0;
      const offset = 60;
      const { height } = pageSizesRef.current[0];
      return Math.max(0.1, (window.innerHeight - offset) / height);
    }
    if (str === "page width") {
      if (!pageSizesRef.current.length) return 1.0;
      const containerWidth = pdfContainerRef.current
        ? pdfContainerRef.current.clientWidth
        : window.innerWidth;
      const { width } = pageSizesRef.current[0];
      return Math.max(0.1, containerWidth / width);
    }
    if (str.endsWith("%")) {
      let val = parseFloat(str);
      if (!isNaN(val)) return val / 100;
    } else {
      let val = parseFloat(str);
      if (!isNaN(val)) return val;
    }
    return 1.0;
  }

  function formatZoomValue(scale) {
    const pct = Math.round(scale * 100);
    return pct + "%";
  }

  function parseZoomAndRender(str) {
    if (!pdfDoc) return;
    const sc = parseZoomValue(str);
    setZoomScale(sc);
    setZoomValue(formatZoomValue(sc));
    renderAllPages(sc);
  }

  function handlePickZoom(item) {
    setShowZoomMenu(false);
    parseZoomAndRender(item);
  }

  function handleZoomInputChange(e) {
    setZoomValue(e.target.value);
  }

  function handleZoomInputKey(e) {
    if (e.key === "Enter") {
      parseZoomAndRender(zoomValue);
      setShowZoomMenu(false);
    }
  }

  function handleZoomInputBlur() {
    parseZoomAndRender(zoomValue);
    setTimeout(() => setShowZoomMenu(false), 150);
  }

  function handleZoomInputFocus() {
    setShowZoomMenu(true);
  }

  // Helper: place caret at end
  function placeCaretAtEndOf(box) {
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Find active annotation
  const activeAnnotation = annotations.find((a) => a.id === activeAnnotationId);
  const currentFontSize = activeAnnotation
    ? activeAnnotation.fontSize
    : fontSize;
  const currentTextColor = activeAnnotation
    ? activeAnnotation.color
    : textColor;
  const currentHighlight = activeAnnotation
    ? activeAnnotation.highlight
    : highlightColor;

  // Update style of active annotation
  const updateActiveAnnotation = (prop, value) => {
    if (activeAnnotation) {
      const updated = annotationsRef.current.map((a) => {
        if (a.id === activeAnnotation.id) {
          return { ...a, [prop]: value };
        }
        return a;
      });
      updateAnnotations(updated);

      const box = document.querySelector(
        `[data-annid="${activeAnnotation.id}"]`
      );
      if (box) {
        if (prop === "fontSize") {
          box.style.fontSize = value * zoomScale + "px";
          setTimeout(() => {
            box.focus();
            placeCaretAtEndOf(box);
          }, 20);
        } else if (prop === "color") {
          box.style.color = value;
          setTimeout(() => {
            box.focus();
            placeCaretAtEndOf(box);
          }, 20);
        } else if (prop === "highlight") {
          box.style.backgroundColor = hexToRgba(value, 0.4);
          setTimeout(() => {
            box.focus();
            placeCaretAtEndOf(box);
          }, 20);
        }
      }
    } else {
      // If no annotation is active, update the "default" style
      if (prop === "fontSize") setFontSize(value);
      if (prop === "color") setTextColor(value);
      if (prop === "highlight") setHighlightColor(value);
    }
  };

  // On mount, load "saveProgress" setting
  useEffect(() => {
    const sp = localStorage.getItem("saveProgress");
    if (sp !== null) {
      setSaveProgress(sp === "true");
    }
  }, []);

  // Clear local data if user disables saveProgress
  useEffect(() => {
    if (!saveProgress) {
      localStorage.removeItem("savedPDFs");
      localStorage.removeItem("currentPdfName");
    }
  }, [saveProgress]);

  // Dark mode
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

  // Close settings if click outside
  useEffect(() => {
    function handleDocumentClick(e) {
      if (
        showSettings &&
        !e.target.closest(".settings-panel") &&
        !e.target.closest("[title='Settings']")
      ) {
        setShowSettings(false);
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [showSettings]);

  // Global click => if not text box or toolbar => deselect
  useEffect(() => {
    function handleGlobalClick(e) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target) return;
      const isTextBox = !!target.closest(".editable-text");
      const isToolbar = !!target.closest("#toolbar");
      const isSettings = !!target.closest(".settings-panel");
      const isZoomMenu = !!target.closest(".zoom-menu");

      if (!isTextBox && !isToolbar && !isSettings && !isZoomMenu) {
        setActiveAnnotationId(null);
      }
    }
    document.addEventListener("mousedown", handleGlobalClick);
    return () => {
      document.removeEventListener("mousedown", handleGlobalClick);
    };
  }, []);

  // Save on beforeunload
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveProgress && pdfBytes) {
        const savedPDFsStr = localStorage.getItem("savedPDFs") || "{}";
        let savedPDFs = {};
        try {
          savedPDFs = JSON.parse(savedPDFsStr);
        } catch (_) {}
        if (currentPdfName.current) {
          savedPDFs[currentPdfName.current] = {
            pdfBase64: arrayBufferToBase64(pdfBytes),
            annotations: annotationsRef.current,
          };
          localStorage.setItem("savedPDFs", JSON.stringify(savedPDFs));
          localStorage.setItem("currentPdfName", currentPdfName.current);
        }
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pdfBytes, saveProgress]);

  // On mount, try to load last PDF
  useEffect(() => {
    setTimeout(() => {
      const savedName = localStorage.getItem("currentPdfName");
      const savedPDFsStr = localStorage.getItem("savedPDFs");
      if (savedName && savedPDFsStr) {
        currentPdfName.current = savedName;
        loadSavedPDF();
      }
    }, 100);
  }, []);

  // Re-render pages if doc or zoom changes
  useEffect(() => {
    if (pdfDoc && pdfContainerRef.current) {
      pdfContainerRef.current.innerHTML = "";
      renderAllPages(zoomScale);
    }
  }, [pdfDoc, zoomScale]);

  // DRAG & DROP
  useEffect(() => {
    const dropArea = document.getElementById("drop-area");
    if (!dropArea) return;

    function handleDragOver(e) {
      e.preventDefault();
      dropArea.classList.add("drag-over");
    }
    function handleDragLeave(e) {
      e.preventDefault();
      dropArea.classList.remove("drag-over");
    }
    async function handleDrop(e) {
      e.preventDefault();
      dropArea.classList.remove("drag-over");
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/pdf") {
        alert("Please drop a PDF file!");
        return;
      }
      await loadPDFFile(file);
    }

    dropArea.addEventListener("dragover", handleDragOver);
    dropArea.addEventListener("dragleave", handleDragLeave);
    dropArea.addEventListener("drop", handleDrop);

    return () => {
      dropArea.removeEventListener("dragover", handleDragOver);
      dropArea.removeEventListener("dragleave", handleDragLeave);
      dropArea.removeEventListener("drop", handleDrop);
    };
  }, []);

  function loadSavedPDF() {
    const savedName = localStorage.getItem("currentPdfName");
    if (!savedName) return;
    const savedPDFsStr = localStorage.getItem("savedPDFs") || "{}";
    let savedPDFs = {};
    try {
      savedPDFs = JSON.parse(savedPDFsStr);
    } catch (e) {}

    const fileData = savedPDFs[savedName];
    if (!fileData) return;

    const { pdfBase64, annotations: savedAnnotations } = fileData;
    let annArr = savedAnnotations || [];
    annArr = annArr.map((a) => {
      if (a.id == null) {
        a.id = annotationIdCounter.current++;
      } else {
        annotationIdCounter.current = Math.max(
          annotationIdCounter.current,
          a.id + 1
        );
      }
      return a;
    });
    setAnnotations(annArr);
    annotationsRef.current = annArr;

    const ab = base64ToArrayBuffer(pdfBase64);
    const bytes = new Uint8Array(ab);
    setPdfBytes(bytes);
    window.pdfjsLib
      .getDocument(bytes)
      .promise.then((doc) => {
        setPdfDoc(doc);
        setPdfLoaded(true);
        setNumPages(doc.numPages);
        const sizes = [];
        let count = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          doc
            .getPage(i)
            .then((page) => {
              const vp = page.getViewport({ scale: 1 });
              sizes[i - 1] = { width: vp.width, height: vp.height };
              count++;
              if (count === doc.numPages) {
                pageSizesRef.current = sizes;
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => console.log("Error loading PDF:", err));
  }

  // Auto-save on changes
  useEffect(() => {
    if (!saveProgress || !pdfBytes) return;
    const savedPDFsStr = localStorage.getItem("savedPDFs") || "{}";
    let savedPDFs = {};
    try {
      savedPDFs = JSON.parse(savedPDFsStr);
    } catch (e) {}
    if (currentPdfName.current) {
      savedPDFs[currentPdfName.current] = {
        pdfBase64: arrayBufferToBase64(pdfBytes),
        annotations: annotationsRef.current,
      };
      localStorage.setItem("savedPDFs", JSON.stringify(savedPDFs));
      localStorage.setItem("currentPdfName", currentPdfName.current);
    }
  }, [pdfBytes, annotations, saveProgress]);

  function updateAnnotations(newAnnotations) {
    setAnnotations(newAnnotations);
    annotationsRef.current = newAnnotations;
  }

  // PDF file load
  async function loadPDFFile(file) {
    if (pdfContainerRef.current) {
      pdfContainerRef.current.innerHTML = "";
    }
    setPdfDoc(null);
    setPdfLoaded(false);
    updateAnnotations([]);
    currentPdfName.current = file.name;

    const reader = new FileReader();
    reader.onload = async () => {
      const bytes = new Uint8Array(reader.result);
      setPdfBytes(bytes);
      const doc = await window.pdfjsLib.getDocument(bytes).promise;
      setPdfDoc(doc);
      setPdfLoaded(true);
      setNumPages(doc.numPages);

      const sizes = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        sizes[i - 1] = { width: vp.width, height: vp.height };
      }
      pageSizesRef.current = sizes;
    };
    reader.readAsArrayBuffer(file);
  }

  // Input-based file upload
  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return;
    await loadPDFFile(file);
  }

  // Render all pages
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

    annotations.forEach((ann) => {
      const pageEl = pages[ann.pageIndex];
      if (!pageEl) return;
      const textLayer = pageEl.querySelector(".text-layer");
      if (!textLayer) return;
      const box = createAnnotationBox(ann, ann.id, pageEl);
      textLayer.appendChild(box);
    });
  }

  // Create a single annotation box
  function createAnnotationBox(ann, id, pageEl) {
    const finalFS = ann.fontSize * zoomScale;
    const xPx = ann.xRatio * pageEl.clientWidth;
    const yPx = ann.yRatio * pageEl.clientHeight;

    // Create the container that will hold the text and the resizer.
    const box = document.createElement("div");
    box.className = "editable-text";
    box.setAttribute("data-annid", String(id));
    box.style.left = xPx + "px";
    box.style.top = yPx + "px";
    box.style.fontSize = finalFS + "px";
    box.style.color = ann.color;
    box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
    box.style.overflow = "hidden";
    // Do not set contentEditable on the container; instead we will set it on its child.

    // If dimensions exist, apply them.
    if (ann.widthRatio) {
      box.style.width =
        parseFloat((ann.widthRatio * pageEl.clientWidth).toFixed(2)) + "px";
    }
    if (ann.heightRatio) {
      box.style.height =
        parseFloat((ann.heightRatio * pageEl.clientHeight).toFixed(2)) + "px";
    }

    // Create a dedicated child for the text.
    const textSpan = document.createElement("span");
    textSpan.className = "text-content";
    // Make the text span editable.
    textSpan.contentEditable = pdfLoaded ? "true" : "false";
    textSpan.style.outline = "none";
    // Set the text; this way if we update textSpan.innerText it will not remove the resizer.
    textSpan.innerText = ann.text || "";

    // When the user types in the textSpan, update the annotation.
    textSpan.addEventListener("input", () => {
      updateAnnotations(
        annotationsRef.current.map((a) => {
          if (a.id === id) {
            return { ...a, text: textSpan.innerText };
          }
          return a;
        })
      );
    });

    textSpan.addEventListener("focus", () => {
      setActiveAnnotationId(id);
      // If it has the placeholder text, clear it.
      if (textSpan.innerText === "Edit me!") {
        textSpan.innerText = "";
        updateAnnotations(
          annotationsRef.current.map((a) => {
            if (a.id === id) {
              return { ...a, text: "" };
            }
            return a;
          })
        );
      }
      // Place caret at the end.
      setTimeout(() => {
        placeCaretAtEndOf(textSpan);
      }, 0);
    });

    // Append the textSpan to the container.
    box.appendChild(textSpan);

    // Create the resizer element (it will remain untouched even when text changes).
    const resizer = document.createElement("div");
    resizer.className = "resizer";
    box.appendChild(resizer);

    // Ensure the resizer stays appended when the box is focused or mousedown.
    box.addEventListener("mousedown", () => {
      if (!box.querySelector(".resizer")) {
        box.appendChild(resizer);
      }
    });
    box.addEventListener("focus", () => {
      if (!box.querySelector(".resizer")) {
        box.appendChild(resizer);
      }
    });

    // DRAG events on the container.
    let isDragging = false;
    let offsetX = 0,
      offsetY = 0;
    box.addEventListener("mousedown", (e) => {
      // Avoid starting drag if the target is the resizer or inside textSpan (so editing is not interrupted).
      if (e.target.classList.contains("resizer")) return;
      isDragging = true;
      const r = box.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
      e.stopPropagation();
      setActiveAnnotationId(id);
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
      updateAnnotations(
        annotationsRef.current.map((a) => {
          if (a.id === id) {
            return {
              ...a,
              xRatio: newX / rect.width,
              yRatio: newY / rect.height,
            };
          }
          return a;
        })
      );
    });
    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        updateAnnotations(
          annotationsRef.current.map((a) => {
            if (a.id === id) {
              const wRatio = box.offsetWidth / pageEl.clientWidth;
              return {
                ...a,
                widthRatio: parseFloat(wRatio.toFixed(4)),
              };
            }
            return a;
          })
        );
      }
    });

    // RESIZING events for the resizer.
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
        const rect = pageEl.getBoundingClientRect();
        updateAnnotations(
          annotationsRef.current.map((a) => {
            if (a.id === id) {
              return {
                ...a,
                widthRatio: parseFloat(
                  (box.offsetWidth / rect.width).toFixed(4)
                ),
                heightRatio: parseFloat(
                  (box.offsetHeight / rect.height).toFixed(4)
                ),
              };
            }
            return a;
          })
        );
      }
    });

    return box;
  }

  // Add new text box
  function handleAddTextBox() {
    if (!pdfLoaded) {
      alert("Please load a PDF first!");
      return;
    }
    if (isPlacingAnnotation) return;

    setIsPlacingAnnotation(true);
    const div = document.createElement("div");
    div.className = "editable-text";
    div.style.pointerEvents = "none";
    div.style.position = "fixed";
    // Example offset transform
    div.style.transform = "translate(-10px, -10px)";
    div.style.borderColor = "#d44";
    div.style.padding = "2px";
    div.style.backgroundColor = hexToRgba(highlightColor, 0.4);
    div.style.color = textColor;
    div.style.overflow = "hidden";
    div.innerText = "Edit me!";
    div.style.fontSize = fontSize * zoomScale + "px";
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
        const x = e.clientX - rect.left - 10; // match the -10 offset
        const y = e.clientY - rect.top - 10;
        const pages = [
          ...pdfContainerRef.current.querySelectorAll(".pdf-page"),
        ];
        const pIndex = pages.indexOf(pageEl);
        const newAnn = {
          id: annotationIdCounter.current++,
          pageIndex: pIndex,
          xRatio: x / rect.width,
          yRatio: y / rect.height,
          text: "Edit me!",
          fontSize: fontSize,
          color: textColor,
          highlight: highlightColor,
          widthRatio: 0,
          heightRatio: 0,
        };
        updateAnnotations([...annotationsRef.current, newAnn]);
        const textLayer = pageEl.querySelector(".text-layer");
        if (textLayer) {
          const boxNode = createAnnotationBox(newAnn, newAnn.id, pageEl);
          textLayer.appendChild(boxNode);
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("click", onClick);
        div.remove();
        setIsPlacingAnnotation(false);
      }
    };
    document.addEventListener("click", onClick);
  }

  // Download
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
    for (let ann of annotationsRef.current) {
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
      <div id="toolbar">
        <label
          htmlFor="file-input"
          className="button"
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          Upload PDF
        </label>
        <input
          id="file-input"
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
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
        <button onClick={handleAddTextBox} className="button">
          + Text
        </button>
        <label style={{ marginLeft: "1rem" }}>Color:</label>
        <input
          type="color"
          value={currentTextColor}
          onChange={(e) => updateActiveAnnotation("color", e.target.value)}
        />
        <label style={{ marginLeft: "1rem" }}>Highlight:</label>
        <input
          type="color"
          value={currentHighlight}
          onChange={(e) => updateActiveAnnotation("highlight", e.target.value)}
        />
        <label style={{ marginLeft: "1rem" }}>Text Size:</label>
        <input
          type="number"
          min={1}
          max={200}
          step={1}
          value={currentFontSize}
          onChange={(e) =>
            updateActiveAnnotation("fontSize", parseFloat(e.target.value) || 1)
          }
          style={{ width: "60px" }}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <button onClick={handleDownload} className="button">
            Download PDF
          </button>
          <button
            className="button"
            onClick={() => setShowSettings((p) => !p)}
            style={{
              position: "relative",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            ref={gearRef}
            title="Settings"
          >
            <img
              src="https://img.icons8.com/material-rounded/36/000000/settings.png"
              alt="Settings"
              style={{ width: "36px", height: "36px" }}
            />
            {showSettings && (
              <div
                className="settings-panel"
                ref={settingsRef}
                onClick={(e) => e.stopPropagation()}
              >
                <label className="settings-item">
                  <span>Dark Mode</span>
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={(e) => setDarkMode(e.target.checked)}
                  />
                </label>
                <label className="settings-item">
                  <span>Auto-format Paste</span>
                  <input
                    type="checkbox"
                    checked={autoFormatPaste}
                    onChange={(e) => setAutoFormatPaste(e.target.checked)}
                  />
                </label>
                <label className="settings-item">
                  <span>Save Progress</span>
                  <input
                    type="checkbox"
                    checked={saveProgress}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSaveProgress(val);
                      localStorage.setItem("saveProgress", String(val));
                    }}
                  />
                </label>
              </div>
            )}
          </button>
        </div>
      </div>
      <div id="drop-area">
        <p>
          Drag &amp; Drop PDF Here
          <br />
          or click "Upload PDF"
        </p>
      </div>
      <div ref={pdfContainerRef} id="pdf-container" />
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
          --button-bg: rgba(240, 240, 240, 0.7);
          --button-hover: rgba(220, 220, 220, 0.8);
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
          --button-bg: rgba(60, 60, 60, 0.7);
          --button-hover: rgba(80, 80, 80, 0.8);
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
          transition: background 0.3s ease, color 0.3s ease;
        }
        #drop-area {
          border: 2px dashed #bbb;
          margin: 60px 20px 20px;
          padding: 20px;
          text-align: center;
          border-radius: 6px;
          transition: background 0.3s ease, color 0.3s ease;
        }
        #drop-area.drag-over {
          background: #eaeaea;
        }
        body.dark #drop-area {
          background: #2c2c2c;
          color: #ddd;
        }
        #pdf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100vw;
          overflow-x: auto;
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
          outline: none;
          min-width: 30px;
          min-height: 20px;
          white-space: pre-wrap;
          word-break: break-word;
          overflow: hidden;
          cursor: move;
        }
        .editable-text:focus {
          cursor: text !important;
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
          z-index: 99;
        }
        .button {
          background: var(--button-bg);
          border: none;
          color: var(--text-color);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          backdrop-filter: blur(5px);
          transition: background 0.2s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .button:hover {
          background: var(--button-hover);
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
          transition: background 0.3s ease, color 0.3s ease;
          color: var(--text-color);
        }
        .settings-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          cursor: pointer;
        }
        .settings-item span {
          flex-grow: 1;
          user-select: none;
        }
        .zoom-input {
          padding: 4px;
          border: 1px solid #888;
          border-radius: 4px;
        }
        .zoom-menu {
          position: absolute;
          top: 38px;
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
