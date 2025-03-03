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

/* ---------- Main Component ---------- */
export default function Home() {
  // Zoom state – one for the final (re-render) scale and one for immediate feedback.
  const [zoomScale, setZoomScale] = useState(1.5);
  const [tempZoomScale, setTempZoomScale] = useState(1.5);
  const [zoomValue, setZoomValue] = useState("150%");

  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoFormatPaste, setAutoFormatPaste] = useState(true);
  const [saveProgress, setSaveProgress] = useState(true);

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [numPages, setNumPages] = useState(1);

  // Default text style for new annotations
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState("#000000");
  const [highlightColor, setHighlightColor] = useState("#ffffff");

  // Store the original (scale=1) page sizes for "page fit" and "page width" calculations.
  const originalPageSizesRef = useRef([]);
  // Also store the current CSS sizes (for aligning annotations)
  const pageSizesRef = useRef([]);

  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  const annotationIdCounter = useRef(0);

  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [isPlacingAnnotation, setIsPlacingAnnotation] = useState(false);

  const pdfContainerRef = useRef(null);
  const currentPdfName = useRef(null);

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

  // For center-on-mouse zoom: store the last mouse position.
  const scrollAnchorRef = useRef({ mouseX: undefined, mouseY: undefined });

  // For throttling/debouncing the zoom updates.
  const lastWheelTimeRef = useRef(0);
  const finalTimerRef = useRef(null);

  // Render cancellation token.
  const renderIdRef = useRef(0);

  /* ---------- Helper: updateAnnotations ---------- */
  function updateAnnotations(newAnnotations) {
    setAnnotations(newAnnotations);
    annotationsRef.current = newAnnotations;
  }

  /* ---------- Zoom Functions ---------- */
  // Use original page dimensions for accurate "Page Fit" and "Page Width"
  function parseZoomValue(str) {
    str = str.trim().toLowerCase();
    if (str === "actual size") return 1.0;
    if (str === "page fit") {
      if (!originalPageSizesRef.current.length) return 1.0;
      const offset = 60;
      const { height } = originalPageSizesRef.current[0];
      return Math.max(0.1, (window.innerHeight - offset) / height);
    }
    if (str === "page width") {
      if (!originalPageSizesRef.current.length) return 1.0;
      const containerWidth = pdfContainerRef.current
        ? pdfContainerRef.current.clientWidth
        : window.innerWidth;
      const { width } = originalPageSizesRef.current[0];
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
    setTempZoomScale(sc);
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

  /* ---------- Helper: Place Caret At End ---------- */
  function placeCaretAtEndOf(box) {
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Determine active annotation and defaults
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

  /* ---------- Update Active Annotation ---------- */
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
          const newFontSize = value * zoomScale;
          // Update the container's font-size.
          box.style.fontSize = newFontSize + "px";
          const textEl = box.querySelector(".text-content");
          if (textEl) {
            // Apply our helper to update both font size and dynamic line-height.
            applyFontStyles(textEl, newFontSize);
            textEl.focus();
            placeCaretAtEndOf(textEl);
          }
        } else if (prop === "color") {
          box.style.color = value;
          setTimeout(() => {
            const textEl = box.querySelector(".text-content");
            if (textEl) {
              textEl.focus();
              placeCaretAtEndOf(textEl);
            }
          }, 20);
        } else if (prop === "highlight") {
          box.style.backgroundColor = hexToRgba(value, 0.4);
          setTimeout(() => {
            const textEl = box.querySelector(".text-content");
            if (textEl) {
              textEl.focus();
              placeCaretAtEndOf(textEl);
            }
          }, 20);
        }
      }
    } else {
      if (prop === "fontSize") setFontSize(value);
      if (prop === "color") setTextColor(value);
      if (prop === "highlight") setHighlightColor(value);
    }
  };

  /* ---------- Lifecycle Hooks ---------- */
  useEffect(() => {
    const sp = localStorage.getItem("saveProgress");
    if (sp !== null) {
      setSaveProgress(sp === "true");
    }
  }, []);

  useEffect(() => {
    if (!saveProgress) {
      localStorage.removeItem("savedPDFs");
      localStorage.removeItem("currentPdfName");
    }
  }, [saveProgress]);

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

  useEffect(() => {
    function handleGlobalClick(e) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const isTextBox = !!target.closest(".editable-text");
      const isToolbar = !!target.closest("#toolbar");
      const isSettings = !!target.closest(".settings-panel");
      const isZoomMenu = !!target.closest(".zoom-menu");
      if (!isTextBox && !isToolbar && !isSettings && !isZoomMenu) {
        setActiveAnnotationId(null);
      }
    }
    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, []);

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

  // Single useEffect that re-renders pages when either pdfDoc or zoomScale changes.
  useEffect(() => {
    if (pdfDoc && pdfContainerRef.current) {
      const container = pdfContainerRef.current;
      const rect = container.getBoundingClientRect();
      // Determine the anchor point for center-on-mouse.
      let anchorX = rect.width / 2;
      let anchorY = rect.height / 2;
      if (scrollAnchorRef.current.mouseX !== undefined) {
        anchorX = scrollAnchorRef.current.mouseX - rect.left;
        anchorY = scrollAnchorRef.current.mouseY - rect.top;
      }
      // Calculate ratios based on current scroll.
      const ratioX = (container.scrollLeft + anchorX) / container.scrollWidth;
      const ratioY = (container.scrollTop + anchorY) / container.scrollHeight;

      renderAllPages(zoomScale).then(() => {
        // Restore scroll so the anchor remains in place.
        setTimeout(() => {
          const newScrollLeft = ratioX * container.scrollWidth - anchorX;
          const newScrollTop = ratioY * container.scrollHeight - anchorY;
          container.scrollLeft = newScrollLeft;
          container.scrollTop = newScrollTop;
        }, 0);
      });
    }
  }, [zoomScale, pdfDoc]);

  // Attach Ctrl+Wheel listener that uses center-on-mouse zoom and throttles/debounces updates.
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Record mouse position.
      scrollAnchorRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
      };

      const now = Date.now();
      const THROTTLE_INTERVAL = 80; // ms
      const DEBOUNCE_DELAY = 200; // ms
      let newScale = tempZoomScale;
      const zoomStep = 0.1;

      if (e.deltaY < 0) {
        newScale += zoomStep;
      } else {
        newScale = Math.max(0.1, newScale - zoomStep);
      }

      // Immediate feedback update.
      setTempZoomScale(newScale);
      setZoomValue(formatZoomValue(newScale));

      if (now - lastWheelTimeRef.current > THROTTLE_INTERVAL) {
        setZoomScale(newScale);
        lastWheelTimeRef.current = now;
      }

      if (finalTimerRef.current) {
        clearTimeout(finalTimerRef.current);
      }
      finalTimerRef.current = setTimeout(() => {
        setZoomScale(newScale);
        lastWheelTimeRef.current = 0;
      }, DEBOUNCE_DELAY);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel, { passive: false });
    };
  }, [tempZoomScale]);

  /* ---------- PDF Loading and Rendering ---------- */
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
                originalPageSizesRef.current = sizes;
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => console.log("Error loading PDF:", err));
  }

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
      originalPageSizesRef.current = sizes;
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return;
    await loadPDFFile(file);
  }

  async function renderAllPages(scale) {
    if (!pdfDoc) return;
    // Increment the render cancellation token.
    const currentRenderId = ++renderIdRef.current;
    const container = pdfContainerRef.current;
    container.innerHTML = ""; // clear old pages

    const dpr = window.devicePixelRatio || 1;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      // If a new render was triggered, cancel this one.
      if (currentRenderId !== renderIdRef.current) return;

      const page = await pdfDoc.getPage(i);
      const origSize = originalPageSizesRef.current[i - 1] || {
        width: 600,
        height: 800,
      };
      const origWidth = origSize.width;
      const origHeight = origSize.height;
      const cssWidth = origWidth * scale;
      const cssHeight = origHeight * scale;
      const roundedWidth = Math.round(cssWidth);
      const roundedHeight = Math.round(cssHeight);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = Math.floor(roundedWidth * dpr);
      canvas.height = Math.floor(roundedHeight * dpr);
      canvas.style.width = roundedWidth + "px";
      canvas.style.height = roundedHeight + "px";
      ctx.scale(dpr, dpr);

      const viewport = page.getViewport({ scale });
      await page.render({ canvasContext: ctx, viewport }).promise;

      const pageDiv = document.createElement("div");
      pageDiv.className = "pdf-page";
      pageDiv.style.width = roundedWidth + "px";
      pageDiv.style.height = roundedHeight + "px";
      pageDiv.style.position = "relative";
      pageDiv.appendChild(canvas);
      container.appendChild(pageDiv);

      const textLayer = document.createElement("div");
      textLayer.className = "text-layer";
      textLayer.style.position = "absolute";
      textLayer.style.top = "0";
      textLayer.style.left = "0";
      textLayer.style.width = "100%";
      textLayer.style.height = "100%";
      textLayer.style.pointerEvents = "none";
      pageDiv.appendChild(textLayer);

      pageSizesRef.current[i - 1] = {
        width: origWidth,
        height: origHeight,
        cssWidth: roundedWidth,
        cssHeight: roundedHeight,
      };
    }

    // Only reapply annotations if this render hasn't been canceled.
    if (currentRenderId === renderIdRef.current) {
      applyAnnotationsAll();
    }
  }

  // Returns a dynamic line-height ratio based on the given font size in pixels.
  function getLineHeightRatio(fontSizePx) {
    // For very small text (<= 12px), use a ratio around 1.2.
    const baseRatio = 1;
    // For very large text (>= 48px), use a ratio around 1.6.
    const maxRatio = 1;
    const minSize = 12; // below or equal -> line-height ratio = baseRatio.
    const maxSize = 48; // above or equal -> line-height ratio = maxRatio.

    if (fontSizePx <= minSize) return baseRatio;
    if (fontSizePx >= maxSize) return maxRatio;

    // Interpolate linearly between baseRatio and maxRatio.
    return (
      baseRatio +
      ((maxRatio - baseRatio) * (fontSizePx - minSize)) / (maxSize - minSize)
    );
  }

  // Helper that applies the given font size and its corresponding line-height to the element.
  function applyFontStyles(element, fontSizeValue) {
    // fontSizeValue should already include the zoomScale (i.e. the final font size in pixels)
    const ratio = getLineHeightRatio(fontSizeValue);
    element.style.fontSize = fontSizeValue + "px";
    element.style.lineHeight = ratio + "em";
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

  /* ---------- Create Annotation Box ---------- */
  function createAnnotationBox(ann, id, pageEl) {
    // Get current CSS dimensions for the page
    const { cssWidth, cssHeight } = pageSizesRef.current[ann.pageIndex];
    const finalFS = ann.fontSize * zoomScale;

    // Create the container for the annotation box
    const box = document.createElement("div");
    box.className = "editable-text";
    box.setAttribute("data-annid", String(id));
    box.style.boxSizing = "border-box";
    box.style.fontSize = finalFS + "px";
    box.style.color = ann.color;
    box.style.backgroundColor = hexToRgba(ann.highlight, 0.4);
    box.style.overflow = "visible";
    // Increase bottom padding so the resizer is not cut off
    box.style.paddingBottom = "14px";
    box.style.position = "absolute";

    // Position the box based on ratios
    const xPx = ann.xRatio * cssWidth;
    const yPx = ann.yRatio * cssHeight;
    box.style.left = xPx + "px";
    box.style.top = yPx + "px";

    if (ann.widthRatio) {
      box.style.width = (ann.widthRatio * cssWidth).toFixed(2) + "px";
    }
    if (ann.heightRatio) {
      box.style.height = (ann.heightRatio * cssHeight).toFixed(2) + "px";
    }

    // Create the editable text span
    const textSpan = document.createElement("span");
    textSpan.className = "text-content";
    textSpan.contentEditable = pdfLoaded ? "true" : "false";
    textSpan.style.outline = "none";
    textSpan.style.display = "block";
    textSpan.style.verticalAlign = "top";

    // Apply dynamic font size and line-height using our helper function
    // (finalFS already includes zoomScale)
    applyFontStyles(textSpan, finalFS);

    // Ensure the text span covers the available area so clicks anywhere are captured.
    textSpan.style.width = "100%";
    textSpan.style.height = "100%";
    textSpan.style.cursor = "text";
    textSpan.innerText = ann.text || "";
    if (ann.isNew) {
      textSpan.classList.add("placeholder");
    }

    // Prevent the box's drag logic from triggering when clicking inside the text.
    textSpan.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    textSpan.addEventListener("input", () => {
      updateAnnotations(
        annotationsRef.current.map((a) => {
          if (a.id === id) {
            return { ...a, text: textSpan.innerText };
          }
          return a;
        })
      );

      const boxRect = box.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const newWidthRatio = boxRect.width / pageRect.width;
      const newHeightRatio = boxRect.height / pageRect.height;
      updateAnnotations(
        annotationsRef.current.map((a) => {
          if (a.id === id) {
            return {
              ...a,
              widthRatio: parseFloat(newWidthRatio.toFixed(4)),
              heightRatio: parseFloat(newHeightRatio.toFixed(4)),
            };
          }
          return a;
        })
      );
    });

    textSpan.addEventListener("focus", () => {
      setActiveAnnotationId(id);
      if (ann.isNew) {
        const updated = annotationsRef.current.map((a) => {
          if (a.id === id) {
            return { ...a, isNew: false };
          }
          return a;
        });
        updateAnnotations(updated);
        textSpan.classList.remove("placeholder");
      }
    });

    textSpan.addEventListener("keydown", (e) => {
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        textSpan.innerText.trim() === ""
      ) {
        e.preventDefault();
        updateAnnotations(annotationsRef.current.filter((a) => a.id !== id));
        box.remove();
      }
    });

    box.appendChild(textSpan);

    // Create the resizer element
    const resizer = document.createElement("div");
    resizer.className = "resizer";
    box.appendChild(resizer);

    // Mousedown on box: differentiate between editing and dragging.
    box.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("resizer")) return;
      const rect = box.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const margin = 10;
      if (
        clickX > margin &&
        clickX < rect.width - margin &&
        clickY > margin &&
        clickY < rect.height - margin
      ) {
        if (document.activeElement !== textSpan) {
          textSpan.focus();
        }
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      isDragging = true;
      offsetX = clickX;
      offsetY = clickY;
      e.stopPropagation();
      setActiveAnnotationId(id);
    });

    // Dragging logic
    let isDragging = false;
    let offsetX = 0,
      offsetY = 0;
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
              return { ...a, widthRatio: parseFloat(wRatio.toFixed(4)) };
            }
            return a;
          })
        );
      }
    });

    // Resizing logic
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

  /* ---------- New Text Box Placement ---------- */
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
          text: "",
          isNew: true,
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

  /* ---------- PDF Download (Export) ---------- */
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

    // Helper to break long words to fit within a given max width.
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

    // Helper to wrap a line into multiple lines if needed.
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

    // Helper to convert hex color to rgb.
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

    // Process each annotation and add it to the corresponding PDF page.
    for (let ann of annotationsRef.current) {
      if (!pages[ann.pageIndex]) continue;

      const page = pages[ann.pageIndex];
      const pw = page.getWidth();
      const ph = page.getHeight();
      const fs = ann.fontSize;

      const leftX = ann.xRatio * pw;
      const topY = (1 - ann.yRatio) * ph;
      const lineSpace = fs * 1.3;
      const maxW = ann.widthRatio ? ann.widthRatio * pw : 0.8 * pw;
      const rawLines = ann.text.split(/\r?\n/);
      let wrapped = [];
      rawLines.forEach((ln) => {
        wrapped.push(...wrapLine(ln, font, fs, maxW));
      });

      const totalH = wrapped.length * lineSpace;
      if (ann.highlight.toLowerCase() !== "#ffffff") {
        const highlightExtra = fs * 0.5;
        const highlightY = topY - totalH - highlightExtra;
        const highlightHeight = totalH + highlightExtra;

        page.drawRectangle({
          x: leftX,
          y: highlightY,
          width: maxW,
          height: highlightHeight,
          color: hexToRgb(ann.highlight),
          opacity: 0.4,
        });
      }

      const baselineOffset = fs * 0.25; // tweak this value as needed
      for (let i = 0; i < wrapped.length; i++) {
        const baselineY = topY - (i + 1) * lineSpace + baselineOffset;
        page.drawText(wrapped[i], {
          x: leftX,
          y: baselineY,
          size: fs,
          font,
          color: hexToRgb(ann.color),
        });
      }
    }

    // Save the modified PDF.
    const outBytes = await pdfDocLib.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);

    // Use the original PDF filename (without .pdf) and append "-edited.pdf".
    const originalName = currentPdfName.current || "downloaded";
    const editedName = originalName.replace(/\.pdf$/i, "") + "-edited.pdf";
    link.download = editedName;

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
        <button onClick={handleAddTextBox} className="button">
          + Text
        </button>
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
          overflow: auto;
          padding-bottom: 100px;
          margin-top: 60px;
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
        .text-content.placeholder:empty:before {
          content: "Edit me!";
          pointer-events: none;
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
