// web/kinrol_batch_load_images.js
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// ===================== 工具函数 =====================

function getImageListWidget(node) {
    return node?.widgets?.find((w) => w.name === "image_list");
}

function getMaxRowsWidget(node) {
    return node?.widgets?.find((w) => w.name === "max_rows");
}

function parseImageList(value) {
    return (value || "")
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function setImageList(node, names) {
    const w = getImageListWidget(node);
    if (!w) return;
    w.value = names.join("\n");
    w.callback?.(w.value);
}

function getViewUrl(filename) {
    return `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`;
}

// ===================== 全局拖拽处理 =====================

function isFilesDragEvent(e) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types || []).includes("Files");
}

const _batchLoadImagesDomUIs = new Set();

function _setDraggingUI(activeEntry) {
    for (const entry of _batchLoadImagesDomUIs) {
        entry?.setDragging?.(entry === activeEntry);
    }
}

let _globalDragDropInstalled = false;

function ensureGlobalDragDropPrevention() {
    if (_globalDragDropInstalled) return;
    _globalDragDropInstalled = true;

    window.addEventListener(
        "dragover",
        (e) => {
            if (!isFilesDragEvent(e)) return;
            e.preventDefault();
            const hit = [..._batchLoadImagesDomUIs].find((entry) =>
                entry?.container?.contains(e.target)
            );
            _setDraggingUI(hit || null);
        },
        { capture: true }
    );

    window.addEventListener(
        "drop",
        async (e) => {
            if (!isFilesDragEvent(e)) return;
            e.preventDefault();
            const hit = [..._batchLoadImagesDomUIs].find((entry) =>
                entry?.container?.contains(e.target)
            );
            _setDraggingUI(null);
            if (!hit) return;
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length === 0) return;
            await uploadFilesSequential(hit.node, files, { replace: false });
        },
        { capture: true }
    );

    window.addEventListener(
        "dragleave",
        () => _setDraggingUI(null),
        { capture: true }
    );
}

// ===================== 图片上传 =====================

async function uploadOneImage(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");
    const resp = await api.fetchApi("/upload/image", {
        method: "POST",
        body,
    });
    if (!resp.ok) {
        throw new Error(await resp.text());
    }
    const json = await resp.json();
    return json?.name;
}

async function uploadFilesSequential(node, files, { replace = false } = {}) {
    const w = getImageListWidget(node);
    if (!w) return [];

    const existing = replace ? [] : parseImageList(w.value);
    const uploaded = [];

    const ui = node._kinrolBatchLoadImagesUI;
    if (ui) ui.setStatus(`正在上传 0/${files.length} ...`);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || (file.type && !file.type.startsWith("image/"))) continue;
        const name = await uploadOneImage(file);
        if (name) uploaded.push(name);
        if (ui) ui.setStatus(`正在上传 ${i + 1}/${files.length} ...`);
    }

    const merged = existing.concat(uploaded);
    setImageList(node, merged);

    if (ui) ui.setStatus("");
    return uploaded;
}

// ===================== 文件选择 =====================

function openMultiSelect(node, { replace = false } = {}) {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.multiple = true;
        input.style.display = "none";
        document.body.appendChild(input);

        input.onchange = async (e) => {
            try {
                const files = Array.from(e.target.files || []);
                await uploadFilesSequential(node, files, { replace });
                resolve();
            } catch (err) {
                console.error("上传失败:", err);
            } finally {
                document.body.removeChild(input);
            }
        };
        input.click();
    });
}

function openFolderSelect(node, { replace = false } = {}) {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.multiple = true;
        input.webkitdirectory = true;
        input.directory = true;
        input.style.display = "none";
        document.body.appendChild(input);

        input.onchange = async (e) => {
            try {
                let files = Array.from(e.target.files || []);
                const allowExt = new Set([".png", ".jpg", ".jpeg", ".webp"]);
                files = files.filter((f) => {
                    const name = (f?.name || "").toLowerCase();
                    for (const ext of allowExt) if (name.endsWith(ext)) return true;
                    return false;
                });
                files.sort((a, b) =>
                    (a.webkitRelativePath || a.name).localeCompare(
                        b.webkitRelativePath || b.name
                    )
                );
                await uploadFilesSequential(node, files, { replace });
                resolve();
            } catch (err) {
                console.error("文件夹上传失败:", err);
            } finally {
                document.body.removeChild(input);
            }
        };
        input.click();
    });
}

// ===================== 队列操作 =====================

async function queueAllSequential(node) {
    const w = getImageListWidget(node);
    if (!w) return;
    const names = parseImageList(w.value);
    if (names.length === 0) {
        alert("没有图片可以入队");
        return;
    }

    const modeWidget = node.widgets?.find((w) => w.name === "mode");
    const indexWidget = node.widgets?.find((w) => w.name === "index");

    if (modeWidget) {
        modeWidget.value = "single";
        modeWidget.callback?.("single");
    }

    for (let i = 0; i < names.length; i++) {
        if (indexWidget) {
            indexWidget.value = i;
            indexWidget.callback?.(i);
        }
        await app.queuePrompt();
    }
}

// ===================== UI 构建 =====================

function createBrowserUI(node) {
    let selectedFiles = new Set();

    const container = document.createElement("div");
    container.style.cssText = `
        width: 100%;
        padding: 8px;
        background: var(--comfy-menu-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        margin: 5px 0;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
    `;

    // 按钮行（已移除“入队当前”）
    const btnRow = document.createElement("div");
    btnRow.style.cssText = `
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
        flex-wrap: wrap;
    `;

    const mkBtn = (label) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText = `
            flex: 1;
            min-width: 56px;
            padding: 6px 4px;
            background: var(--comfy-input-bg);
            color: var(--input-text);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
        `;
        return b;
    };

    const replaceBtn = mkBtn("选择图片");
    const addBtn = mkBtn("追加图片");
    const folderBtn = mkBtn("选择文件夹");
    const queueAllBtn = mkBtn("逐张入队");
    const queueSelectedBtn = mkBtn("入队选中");
    const deleteSelectedBtn = mkBtn("删除选中");
    const deselectBtn = mkBtn("取消选中");
    const clearBtn = mkBtn("清空");

    btnRow.appendChild(replaceBtn);
    btnRow.appendChild(addBtn);
    btnRow.appendChild(folderBtn);
    btnRow.appendChild(queueAllBtn);
    btnRow.appendChild(queueSelectedBtn);
    btnRow.appendChild(deleteSelectedBtn);
    btnRow.appendChild(deselectBtn);
    btnRow.appendChild(clearBtn);

    // 品牌标识
    const brand = document.createElement("div");
    brand.textContent = "Kinrol Batch Load Images";
    brand.style.cssText = `
        font-size: 10px;
        opacity: 0.7;
        margin-bottom: 8px;
        text-align: center;
        color: var(--input-text);
        flex-shrink: 0;
    `;

    // 状态栏
    const statusBar = document.createElement("div");
    statusBar.style.cssText = `
        font-size: 12px;
        color: #4a6;
        margin-bottom: 6px;
        min-height: 1.2em;
        flex-shrink: 0;
    `;

    // 信息栏 + 行数控件
    const infoRow = document.createElement("div");
    infoRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        flex-shrink: 0;
    `;

    const info = document.createElement("div");
    info.style.cssText = `
        font-size: 12px;
        opacity: 0.85;
    `;

    const rowControl = document.createElement("div");
    rowControl.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
    `;

    const rowLabel = document.createElement("span");
    rowLabel.textContent = "最大行数:";
    const rowInput = document.createElement("input");
    rowInput.type = "number";
    rowInput.min = 1;
    rowInput.max = 20;
    rowInput.step = 1;
    rowInput.style.cssText = `
        width: 50px;
        background: var(--comfy-input-bg);
        color: var(--input-text);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 12px;
    `;

    rowControl.appendChild(rowLabel);
    rowControl.appendChild(rowInput);
    infoRow.appendChild(info);
    infoRow.appendChild(rowControl);

    // 图片网格
    const grid = document.createElement("div");
    grid.style.cssText = `
        display: none;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 6px;
        overflow-y: auto;
        background: var(--comfy-input-bg);
        padding: 6px;
        border-radius: 4px;
        flex: 1 1 auto;
        min-height: 0;
        position: relative;
        user-select: none;
    `;

    const updateInfo = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        const selectedCount = selectedFiles.size;
        info.textContent = names.length
            ? `已选择 ${names.length} 张${selectedCount > 0 ? ` (选中 ${selectedCount})` : ""}`
            : "暂无图片";
    };

    const getMaxRows = () => {
        const widget = getMaxRowsWidget(node);
        return widget ? widget.value : 5;
    };

    const setMaxRows = (value) => {
        const widget = getMaxRowsWidget(node);
        if (widget) {
            widget.value = value;
            widget.callback?.(value);
        }
    };

    const ESTIMATED_ROW_HEIGHT = 120;
    const updateGridMaxHeight = () => {
        const maxRows = getMaxRows();
        const baseHeight = maxRows * ESTIMATED_ROW_HEIGHT;
        const containerHeight = container.clientHeight;
        if (!containerHeight) return;

        const fixedHeight =
            btnRow.offsetHeight +
            brand.offsetHeight +
            statusBar.offsetHeight +
            infoRow.offsetHeight +
            16;
        const availableHeight = containerHeight - fixedHeight;
        const targetHeight = Math.max(baseHeight, availableHeight);
        grid.style.maxHeight = `${targetHeight}px`;
    };

    const resizeObserver = new ResizeObserver(() => {
        updateGridMaxHeight();
    });
    resizeObserver.observe(container);

    const clearSelection = () => {
        selectedFiles.clear();
        grid.querySelectorAll(".kinrol-selected").forEach((el) => el.classList.remove("kinrol-selected"));
        updateInfo();
    };

    const updateElementSelection = (el, filename) => {
        if (selectedFiles.has(filename)) {
            el.classList.add("kinrol-selected");
        } else {
            el.classList.remove("kinrol-selected");
        }
    };

    // ===== 全新的拖拽框选逻辑（支持任意位置开始） =====
    let mouseDownX = 0, mouseDownY = 0;
    let mouseDownOnGrid = false;
    let hasStartedSelection = false;
    const DRAG_THRESHOLD = 5; // 移动超过 5px 开始框选

    let selectionRect = null;
    let startX = 0, startY = 0;

    const getGridRelativeCoords = (clientX, clientY) => {
        const rect = grid.getBoundingClientRect();
        return {
            x: clientX - rect.left + grid.scrollLeft,
            y: clientY - rect.top + grid.scrollTop,
        };
    };

    grid.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        // 如果点击的是按钮（如删除），不启动框选，保留默认行为
        if (e.target.closest("button")) return;

        e.preventDefault();
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        mouseDownOnGrid = true;
        hasStartedSelection = false;
    });

    window.addEventListener("mousemove", (e) => {
        if (!mouseDownOnGrid) return;

        const dx = e.clientX - mouseDownX;
        const dy = e.clientY - mouseDownY;
        if (!hasStartedSelection && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
            // 开始框选
            hasStartedSelection = true;
            const coords = getGridRelativeCoords(mouseDownX, mouseDownY);
            startX = coords.x;
            startY = coords.y;

            selectionRect = document.createElement("div");
            selectionRect.style.cssText = `
                position: absolute;
                border: 2px dashed #4a6;
                background: rgba(74, 170, 102, 0.1);
                pointer-events: none;
                z-index: 10;
                left: ${startX}px;
                top: ${startY}px;
                width: 0;
                height: 0;
            `;
            grid.appendChild(selectionRect);
        }

        if (hasStartedSelection) {
            // 更新选择矩形
            const coords = getGridRelativeCoords(e.clientX, e.clientY);
            const left = Math.min(startX, coords.x);
            const top = Math.min(startY, coords.y);
            const width = Math.abs(coords.x - startX);
            const height = Math.abs(coords.y - startY);
            selectionRect.style.left = `${left}px`;
            selectionRect.style.top = `${top}px`;
            selectionRect.style.width = `${width}px`;
            selectionRect.style.height = `${height}px`;
        }
    });

    window.addEventListener("mouseup", (e) => {
        if (!mouseDownOnGrid) return;
        mouseDownOnGrid = false;

        if (hasStartedSelection) {
            // 完成框选
            if (selectionRect) {
                const rect = selectionRect.getBoundingClientRect();
                const thumbCells = grid.querySelectorAll(".kinrol-thumb-cell");

                const insideFiles = new Set();
                thumbCells.forEach((cell) => {
                    const cellRect = cell.getBoundingClientRect();
                    const intersect = !(
                        rect.right < cellRect.left ||
                        rect.left > cellRect.right ||
                        rect.bottom < cellRect.top ||
                        rect.top > cellRect.bottom
                    );
                    const filename = cell.dataset.filename;
                    if (intersect) {
                        insideFiles.add(filename);
                    }
                });

                if (insideFiles.size > 0) {
                    const allInsideAlreadySelected = [...insideFiles].every((f) => selectedFiles.has(f));
                    if (allInsideAlreadySelected) {
                        insideFiles.forEach((f) => selectedFiles.delete(f));
                    } else {
                        insideFiles.forEach((f) => selectedFiles.add(f));
                    }

                    thumbCells.forEach((cell) => {
                        updateElementSelection(cell, cell.dataset.filename);
                    });
                    updateInfo();
                }

                selectionRect.remove();
                selectionRect = null;
            }
        } else {
            // 没有移动，视为单击
            const cell = e.target.closest(".kinrol-thumb-cell");
            if (cell) {
                const filename = cell.dataset.filename;
                if (selectedFiles.has(filename)) {
                    selectedFiles.delete(filename);
                } else {
                    selectedFiles.add(filename);
                }
                updateElementSelection(cell, filename);
                updateInfo();
            }
        }

        hasStartedSelection = false;
    });

    // 防止在网格外松开鼠标时状态未清理
    window.addEventListener("mouseleave", () => {
        if (mouseDownOnGrid && hasStartedSelection) {
            // 如果在框选过程中鼠标移出窗口，取消框选
            if (selectionRect) {
                selectionRect.remove();
                selectionRect = null;
            }
            hasStartedSelection = false;
            mouseDownOnGrid = false;
        }
    });

    // ===== 重绘网格 =====
    const redraw = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        grid.innerHTML = "";

        if (names.length === 0) {
            grid.style.display = "none";
            selectedFiles.clear();
        } else {
            grid.style.display = "grid";
        }

        const frag = document.createDocumentFragment();
        names.forEach((name, idx) => {
            const cell = document.createElement("div");
            cell.className = "kinrol-thumb-cell";
            cell.dataset.filename = name;
            cell.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 3px;
                cursor: pointer;
            `;

            const thumb = document.createElement("div");
            thumb.style.cssText = `
                position: relative;
                aspect-ratio: 1;
                border-radius: 4px;
                overflow: hidden;
                border: 2px solid transparent;
                background: #000;
                transition: border-color 0.15s;
            `;

            const img = document.createElement("img");
            img.src = getViewUrl(name);
            img.alt = name;
            img.loading = "lazy";
            img.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            `;
            img.onerror = () => {
                img.style.display = "none";
                const placeholder = document.createElement("div");
                placeholder.style.cssText = `
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #888;
                    font-size: 12px;
                `;
                placeholder.textContent = "?";
                thumb.appendChild(placeholder);
            };

            const del = document.createElement("button");
            del.textContent = "×";
            del.title = "删除此图片";
            del.style.cssText = `
                position: absolute;
                top: 2px;
                right: 2px;
                width: 20px;
                height: 20px;
                background: rgba(255, 0, 0, 0.75);
                color: #fff;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
                z-index: 5;
            `;
            del.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = names.slice(0, idx).concat(names.slice(idx + 1));
                selectedFiles.delete(name);
                setImageList(node, next);
            };

            const label = document.createElement("div");
            label.textContent = name;
            label.title = name;
            label.style.cssText = `
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                opacity: 0.9;
            `;

            thumb.appendChild(img);
            thumb.appendChild(del);
            cell.appendChild(thumb);
            cell.appendChild(label);
            frag.appendChild(cell);
        });

        grid.appendChild(frag);
        const allCells = grid.querySelectorAll(".kinrol-thumb-cell");
        allCells.forEach((cell) => {
            updateElementSelection(cell, cell.dataset.filename);
        });

        updateInfo();
        updateGridMaxHeight();
        app.graph?.setDirtyCanvas(true);
    };

    const setStatus = (text) => {
        statusBar.textContent = text || "";
    };

    rowInput.value = getMaxRows();
    rowInput.addEventListener("change", () => {
        let val = parseInt(rowInput.value, 10);
        if (isNaN(val)) val = 5;
        val = Math.min(20, Math.max(1, val));
        rowInput.value = val;
        setMaxRows(val);
        updateGridMaxHeight();
        app.graph?.setDirtyCanvas(true);
    });

    container.addEventListener("dragover", (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
    });

    container.addEventListener("drop", async (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer?.files || []);
        await uploadFilesSequential(node, files, { replace: false });
    });

    const setDragging = (on) => {
        container.style.border = on
            ? "2px dashed #4a6"
            : "1px solid var(--border-color)";
    };

    // 按钮事件
    replaceBtn.onclick = () => openMultiSelect(node, { replace: true });
    addBtn.onclick = () => openMultiSelect(node, { replace: false });
    folderBtn.onclick = () => openFolderSelect(node, { replace: true });

    queueAllBtn.onclick = () => queueAllSequential(node);

    queueSelectedBtn.onclick = async () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        const toQueue = names.filter((n) => selectedFiles.has(n));
        if (toQueue.length === 0) {
            alert("请先选中至少一张图片");
            return;
        }

        const modeWidget = node.widgets?.find((w) => w.name === "mode");
        const indexWidget = node.widgets?.find((w) => w.name === "index");
        if (modeWidget) {
            modeWidget.value = "single";
            modeWidget.callback?.("single");
        }

        for (let i = 0; i < toQueue.length; i++) {
            const name = toQueue[i];
            const idx = names.indexOf(name);
            if (idx !== -1 && indexWidget) {
                indexWidget.value = idx;
                indexWidget.callback?.(idx);
            }
            await app.queuePrompt();
        }
    };

    deleteSelectedBtn.onclick = () => {
        if (selectedFiles.size === 0) {
            alert("请先选中要删除的图片");
            return;
        }
        const names = parseImageList(getImageListWidget(node)?.value);
        const remaining = names.filter((n) => !selectedFiles.has(n));
        selectedFiles.clear();
        setImageList(node, remaining);
    };

    deselectBtn.onclick = () => {
        clearSelection();
    };

    clearBtn.onclick = () => {
        selectedFiles.clear();
        setImageList(node, []);
    };

    // 组装 DOM
    container.appendChild(btnRow);
    container.appendChild(brand);
    container.appendChild(statusBar);
    container.appendChild(infoRow);
    container.appendChild(grid);

    const style = document.createElement("style");
    style.textContent = `
        .kinrol-thumb-cell.kinrol-selected > div:first-child {
            border-color: #4a6 !important;
            box-shadow: 0 0 0 1px #4a6;
        }
    `;
    container.appendChild(style);

    setTimeout(() => redraw(), 50);

    return { container, redraw, setDragging, setStatus };
}

// ===================== 注册扩展 =====================

app.registerExtension({
    name: "Kinrol.BatchLoadImages.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KinrolBatchLoadImages") return;

        ensureGlobalDragDropPrevention();

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);

            const imageListWidget = getImageListWidget(this);
            if (imageListWidget) {
                imageListWidget.type = "hidden";
                imageListWidget.computeSize = () => [0, -4];

                const prevCallback = imageListWidget.callback;
                imageListWidget.callback = (value) => {
                    prevCallback?.(value);
                    this._kinrolBatchLoadImagesUI?.redraw();
                };
            }

            const maxRowsWidget = getMaxRowsWidget(this);
            if (maxRowsWidget) {
                maxRowsWidget.type = "hidden";
                maxRowsWidget.computeSize = () => [0, -4];
            }

            const ui = createBrowserUI(this);
            this._kinrolBatchLoadImagesUI = ui;

            this.addDOMWidget("kinrol_batch_load_images", "customwidget", ui.container);
            this.setSize([430]);

            _batchLoadImagesDomUIs.add({
                node: this,
                container: ui.container,
                redraw: ui.redraw,
                setDragging: ui.setDragging,
            });

            const prevOnRemoved = this.onRemoved;
            this.onRemoved = function () {
                for (const entry of _batchLoadImagesDomUIs) {
                    if (entry?.node === this) {
                        _batchLoadImagesDomUIs.delete(entry);
                        break;
                    }
                }
                prevOnRemoved?.apply(this, arguments);
            };

            return r;
        };
    },
});
