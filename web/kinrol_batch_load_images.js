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

async function queueCurrent(node) {
    const w = getImageListWidget(node);
    if (!w) return;
    const names = parseImageList(w.value);
    if (names.length === 0) {
        alert("没有图片可以入队");
        return;
    }
    await app.queuePrompt();
}

// ===================== UI 构建 =====================

function createBrowserUI(node) {
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

    // 按钮行
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
    const queueBtn = mkBtn("逐张入队");
    const queueOneBtn = mkBtn("入队当前");
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "清空";
    clearBtn.style.cssText = `
        padding: 6px 8px;
        background: var(--comfy-input-bg);
        color: var(--input-text);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    `;

    btnRow.appendChild(replaceBtn);
    btnRow.appendChild(addBtn);
    btnRow.appendChild(folderBtn);
    btnRow.appendChild(queueBtn);
    btnRow.appendChild(queueOneBtn);
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
    `;

    const updateInfo = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        info.textContent = names.length
            ? `已选择 ${names.length} 张`
            : "暂无图片";
    };

    // 获取当前设置的行数
    const getMaxRows = () => {
        const widget = getMaxRowsWidget(node);
        return widget ? widget.value : 5;
    };

    // 设置行数并同步到隐藏 widget
    const setMaxRows = (value) => {
        const widget = getMaxRowsWidget(node);
        if (widget) {
            widget.value = value;
            widget.callback?.(value);
        }
    };

    // 动态计算网格 max-height
    const ESTIMATED_ROW_HEIGHT = 120; // 缩略图+标签+间距的估算高度

    const updateGridMaxHeight = () => {
        const maxRows = getMaxRows();
        const baseHeight = maxRows * ESTIMATED_ROW_HEIGHT;

        // 获取容器高度（即节点分配给该 DOM 的高度）
        const containerHeight = container.clientHeight;
        if (!containerHeight) return;

        // 计算固定元素的总高度（按钮行、品牌、状态栏、信息行、内外边距）
        const fixedHeight =
            btnRow.offsetHeight +
            brand.offsetHeight +
            statusBar.offsetHeight +
            infoRow.offsetHeight +
            16; // 容器 padding 8*2

        const availableHeight = containerHeight - fixedHeight;
        // 网格高度至少保证行数高度，若节点被拉大则跟随可用高度
        const targetHeight = Math.max(baseHeight, availableHeight);
        grid.style.maxHeight = `${targetHeight}px`;
    };

    // 监听容器尺寸变化（节点拉伸/收缩）
    const resizeObserver = new ResizeObserver(() => {
        updateGridMaxHeight();
    });
    resizeObserver.observe(container);

    const redraw = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        grid.innerHTML = "";

        if (names.length === 0) {
            grid.style.display = "none";
        } else {
            grid.style.display = "grid";
        }

        const frag = document.createDocumentFragment();
        names.forEach((name, idx) => {
            const cell = document.createElement("div");
            cell.style.cssText = `display: flex; flex-direction: column; gap: 3px;`;

            const thumb = document.createElement("div");
            thumb.style.cssText = `
                position: relative;
                aspect-ratio: 1;
                border-radius: 4px;
                overflow: hidden;
                border: 1px solid var(--border-color);
                background: #000;
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
            del.title = "删除";
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
            `;
            del.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = names.slice(0, idx).concat(names.slice(idx + 1));
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
        updateInfo();
        updateGridMaxHeight();
        app.graph?.setDirtyCanvas(true);
    };

    const setStatus = (text) => {
        statusBar.textContent = text || "";
    };

    // 行数输入控件事件
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

    // 拖拽事件
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
    queueBtn.onclick = () => queueAllSequential(node);
    queueOneBtn.onclick = async () => {
        const wMode = node.widgets?.find((w) => w.name === "mode");
        if (wMode) {
            wMode.value = "single";
            wMode.callback?.(wMode.value);
        }
        await queueCurrent(node);
    };
    clearBtn.onclick = () => {
        setImageList(node, []);
    };

    // 组装 DOM
    container.appendChild(btnRow);
    container.appendChild(brand);
    container.appendChild(statusBar);
    container.appendChild(infoRow);
    container.appendChild(grid);

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

            // 隐藏 max_rows widget（保存值用）
            const maxRowsWidget = getMaxRowsWidget(this);
            if (maxRowsWidget) {
                maxRowsWidget.type = "hidden";
                maxRowsWidget.computeSize = () => [0, -4];
            }

            const ui = createBrowserUI(this);
            this._kinrolBatchLoadImagesUI = ui;

            this.addDOMWidget("kinrol_batch_load_images", "customwidget", ui.container);
            // 设置节点宽度，高度由内容 + 用户拖拽决定
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