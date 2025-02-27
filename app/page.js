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
  // Global states
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoFormatPaste, setAutoFormatPaste] = useState(true);
  const [saveProgress, setSaveProgress] = useState(true);

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [numPages, setNumPages] = useState(1);

  // Unscaled (original) page sizes
  const pageSizesRef = useRef([]);

  // Annotations state & ref
  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  const annotationIdCounter = useRef(0);

  const [placingAnnotation, setPlacingAnnotation] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState(null);

  const pdfContainerRef = useRef(null);

  // Current PDF file name
  const currentPdfName = useRef(null);

  // Zoom state
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
      // Use the pdf container width if available
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
    console.log("Parsed zoom value:", sc);
    setZoomScale(sc);
    setZoomValue(formatZoomValue(sc));
    renderAllPages(sc);
  }

  function handlePickZoom(item) {
    console.log("Picked zoom item:", item);
    setShowZoomMenu(false);
    parseZoomAndRender(item);
  }

  function handleZoomInputChange(e) {
    console.log("Zoom input changed:", e.target.value);
    setZoomValue(e.target.value);
  }

  function handleZoomInputKey(e) {
    if (e.key === "Enter") {
      console.log("Zoom input Enter pressed:", zoomValue);
      parseZoomAndRender(zoomValue);
      setShowZoomMenu(false);
    }
  }

  function handleZoomInputBlur() {
    console.log("Zoom input blur:", zoomValue);
    parseZoomAndRender(zoomValue);
    setTimeout(() => setShowZoomMenu(false), 150);
  }

  function handleZoomInputFocus() {
    console.log("Zoom input focused");
    setShowZoomMenu(true);
  }

  // Text style state
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffff00");

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

  // Settings panel behavior: remains open when clicking inside.
  const settingsRef = useRef(null);
  const gearRef = useRef(null);
  useEffect(() => {
    function handleOutsideClick(e) {
      if (!showSettings) return;
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target) &&
        gearRef.current &&
        !gearRef.current.contains(e.target)
      ) {
        console.log("Clicked outside settings, closing panel");
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSettings]);

  // Global blur & click listeners.
  useEffect(() => {
    function globalBlurHandler(e) {
      console.log("Global blur event fired on:", e.target);
    }
    document.addEventListener("blur", globalBlurHandler, true);
    return () => document.removeEventListener("blur", globalBlurHandler, true);
  }, []);

  useEffect(() => {
    function handleGlobalClick(e) {
      const active = document.activeElement;
      if (
        active &&
        active.classList.contains("editable-text") &&
        !active.contains(e.target)
      ) {
        console.log(
          "Global click outside editable text; forcing blur on:",
          active
        );
        active.blur();
      }
    }
    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, []);

  // Save before unload.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saveProgress && pdfBytes) {
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
        console.log("Before unload: final save executed", {
          currentPdfName: currentPdfName.current,
        });
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pdfBytes, saveProgress]);

  // On mount, load saved PDF if exists.
  useEffect(() => {
    setTimeout(() => {
      const savedName = localStorage.getItem("currentPdfName");
      const savedPDFsStr = localStorage.getItem("savedPDFs");
      if (savedName && savedPDFsStr) {
        currentPdfName.current = savedName;
        console.log("Loading saved PDF and annotations for:", savedName);
        loadSavedPDF();
      }
    }, 100);
  }, []);

  // When pdfDoc or zoomScale changes, re-render pages.
  useEffect(() => {
    if (pdfDoc) {
      if (pdfContainerRef.current) {
        pdfContainerRef.current.innerHTML = "";
      }
      renderAllPages(zoomScale);
    }
  }, [pdfDoc, zoomScale]);

  function loadSavedPDF() {
    const savedName = localStorage.getItem("currentPdfName");
    if (!savedName) return;
    const savedPDFsStr = localStorage.getItem("savedPDFs") || "{}";
    let savedPDFs = {};
    try {
      savedPDFs = JSON.parse(savedPDFsStr);
    } catch (e) {
      console.log("Error parsing savedPDFs:", e);
    }
    const fileData = savedPDFs[savedName];
    if (!fileData) return;
    const { pdfBase64, annotations: savedAnnotations } = fileData;
    let annArr = savedAnnotations || [];
    annArr = annArr.map((a) => {
      if (a.id === undefined || a.id === null) {
        a.id = annotationIdCounter.current++;
      } else {
        annotationIdCounter.current = Math.max(
          annotationIdCounter.current,
          a.id + 1
        );
      }
      return a;
    });
    console.log("Loaded annotations (with ids):", annArr);
    setAnnotations(annArr);
    annotationsRef.current = annArr;
    const ab = base64ToArrayBuffer(pdfBase64);
    const bytes = new Uint8Array(ab);
    setPdfBytes(bytes);
    window.pdfjsLib
      .getDocument(bytes)
      .promise.then((doc) => {
        console.log("PDF document loaded from savedPDFs");
        setPdfDoc(doc);
        setPdfLoaded(true);
        setNumPages(doc.numPages);
        // Reset zoom to 100%
        setZoomValue("100%");
        setZoomScale(1.0);
      })
      .catch((err) => console.log("Error loading PDF:", err));
  }

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
    console.log("Auto-saved data:", {
      pdfBytes,
      annotations: annotationsRef.current,
      currentPdfName: currentPdfName.current,
    });
  }, [pdfBytes, annotations, saveProgress]);

  function updateAnnotations(newAnnotations) {
    setAnnotations(newAnnotations);
    annotationsRef.current = newAnnotations;
  }

  // New file upload handler.
  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return;
    console.log("Uploading new PDF:", file.name);
    if (pdfContainerRef.current) {
      pdfContainerRef.current.innerHTML = "";
    }
    // Reset zoom to 100% for new document.
    setZoomValue("100%");
    setZoomScale(1.0);

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
      const arr = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        arr.push({ width: vp.width, height: vp.height });
      }
      pageSizesRef.current = arr;
    };
    reader.readAsArrayBuffer(file);
  }

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
      // Center pages by using flex layout in the container (see CSS below)
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

  function redrawSingleBox(id, pageEl, oldBox) {
    console.log("Redrawing box for annotation id:", id);
    if (oldBox.parentNode) {
      oldBox.parentNode.removeChild(oldBox);
    }
    const ann = annotationsRef.current.find((a) => a.id === id);
    if (!ann) {
      console.log(
        "Annotation with id",
        id,
        "not found during redraw; leaving box as is"
      );
      return;
    }
    const textLayer = pageEl.querySelector(".text-layer");
    if (!textLayer) return;
    const newBox = createAnnotationBox(ann, ann.id, pageEl);
    textLayer.appendChild(newBox);
  }

  // Create annotation box. Now, the final font size is computed as base fontSize * zoomScale,
  // so that the text remains constant relative to the document.
  function createAnnotationBox(ann, id, pageEl) {
    console.log("Creating annotation box for id:", id);
    const finalFS = ann.fontSize * zoomScale;
    const xPx = ann.xRatio * pageEl.clientWidth;
    const yPx = ann.yRatio * pageEl.clientHeight;
    const box = document.createElement("div");
    box.className = "editable-text";
    box.setAttribute("data-annid", String(id));
    box.style.left = xPx + "px";
    box.style.top = yPx + "px";
    box.style.fontSize = finalFS + "px";
    box.style.color = ann.color;
    box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
    box.style.overflow = "hidden";
    box.contentEditable = pdfLoaded ? "true" : "false";
    box.innerText = ann.text;
    if (ann.widthRatio) {
      box.style.width = ann.widthRatio * pageEl.clientWidth + "px";
    }
    if (ann.heightRatio) {
      box.style.height = ann.heightRatio * pageEl.clientHeight + "px";
    }

    const scheduleRedraw = () => {
      if (!box._redrawTimer) {
        box._redrawTimer = setTimeout(() => {
          redrawSingleBox(id, pageEl, box);
          box._redrawTimer = null;
        }, 50);
      }
    };
    box.addEventListener(
      "blur",
      () => {
        console.log("Blur event fired for box id:", id);
        scheduleRedraw();
      },
      true
    );
    box.addEventListener(
      "focusout",
      () => {
        console.log("Focusout event fired for box id:", id);
        scheduleRedraw();
      },
      true
    );

    // Drag events.
    let isDragging = false;
    let offsetX = 0,
      offsetY = 0;
    box.addEventListener("mousedown", (e) => {
      if (!pdfLoaded) return;
      if (e.target.classList.contains("resizer")) return;
      isDragging = true;
      const r = box.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
      e.stopPropagation();
      console.log("Started dragging box id:", id);
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
              return { ...a, widthRatio: box.offsetWidth / pageEl.clientWidth };
            }
            return a;
          })
        );
        console.log("Ended dragging box id:", id);
      }
    });

    box.addEventListener("focus", () => {
      console.log("Box focused for id:", id);
      if (box.innerText === "Edit me!") {
        box.innerText = "";
        updateAnnotations(
          annotationsRef.current.map((a) => {
            if (a.id === id) {
              return { ...a, text: "" };
            }
            return a;
          })
        );
      }
    });

    box.addEventListener("paste", (e) => {
      if (!autoFormatPaste) return;
      e.preventDefault();
      const txt = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, txt);
    });

    box.addEventListener("input", () => {
      console.log("Input event in box id:", id, "new text:", box.innerText);
      updateAnnotations(
        annotationsRef.current.map((a) => {
          if (a.id === id) {
            return { ...a, text: box.innerText };
          }
          return a;
        })
      );
    });

    box.addEventListener("keydown", (e) => {
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !box.innerText.trim()
      ) {
        e.preventDefault();
        console.log("Removing empty box id:", id);
        updateAnnotations(annotationsRef.current.filter((a) => a.id !== id));
        box.remove();
      }
    });

    // Resizer element.
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
      console.log("Started resizing box id:", id);
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
        updateAnnotations(
          annotationsRef.current.map((a) => {
            if (a.id === id) {
              return {
                ...a,
                widthRatio: box.offsetWidth / pageEl.clientWidth,
                heightRatio: box.offsetHeight / pageEl.clientHeight,
              };
            }
            return a;
          })
        );
        console.log("Ended resizing box id:", id);
      }
    });
    return box;
  }

  function handleAddTextBox() {
    if (!pdfLoaded) {
      alert("Please load a PDF first!");
      return;
    }
    if (placingAnnotation) return;
    setPlacingAnnotation(true);

    // Create a floating placeholder that scales with the current zoom.
    const div = document.createElement("div");
    div.className = "editable-text";
    div.style.pointerEvents = "none";
    div.style.position = "fixed";
    div.style.transform = "translate(-10px, -10px)";
    div.style.borderColor = "#d44";
    div.style.padding = "2px";
    div.style.backgroundColor = hexToRgba(highlightColor, 0.4);
    div.style.color = textColor;
    div.style.overflow = "hidden";
    div.innerText = "Edit me!";
    div.style.fontSize = fontSize * zoomScale + "px";
    document.body.appendChild(div);
    console.log("Floating text box created for placement");

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
          fontSize: fontSize, // store base font size
          color: textColor,
          highlight: highlightColor,
          widthRatio: 0,
          heightRatio: 0,
        };
        updateAnnotations([...annotationsRef.current, newAnn]);
        console.log("New annotation added:", newAnn);
        const textLayer = pageEl.querySelector(".text-layer");
        if (textLayer) {
          const boxNode = createAnnotationBox(newAnn, newAnn.id, pageEl);
          textLayer.appendChild(boxNode);
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("click", onClick);
        div.remove();
        setPlacingAnnotation(false);
      }
    };
    document.addEventListener("click", onClick);
  }

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
        <label htmlFor="file-input" className="button">
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
            {/* External gear icon */}
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
      <div ref={pdfContainerRef} id="pdf-container"></div>
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
          --button-bg: rgba(255, 255, 255, 0.15);
          --button-hover: rgba(255, 255, 255, 0.25);
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
          --button-bg: rgba(0, 0, 0, 0.25);
          --button-hover: rgba(0, 0, 0, 0.35);
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
        body.dark #drop-area {
          background: #2c2c2c;
          color: #ddd;
        }
        #pdf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
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
          overflow: hidden;
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
