// web/kinrol_batch_load_images.js
// Full feature version with drag-drop and box selection
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageListWidget(node) {
    return node?.widgets?.find((w) => w.name === "image_list");
}

function parseImageList(value) {
    return (value || "").split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function setImageList(node, names) {
    const w = getImageListWidget(node);
    if (!w) return;
    w.value = names.join("\n");
    w.callback?.(w.value);
}

async function uploadOneImage(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");
    const resp = await api.fetchApi("/upload/image", {
        method: "POST",
        body,
    });
    if (!resp.ok) throw new Error(await resp.text());
    const json = await resp.json();
    return json?.name;
}

async function uploadFilesSequential(node, files, { replace = false } = {}) {
    const w = getImageListWidget(node);
    if (!w) return [];
    const existing = replace ? [] : parseImageList(w.value);
    const uploaded = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || (file.type && !file.type.startsWith("image/"))) continue;
        try {
            const name = await uploadOneImage(file);
            if (name) uploaded.push(name);
        } catch (err) {
            console.error("上传失败:", err);
        }
    }
    setImageList(node, existing.concat(uploaded));
    return uploaded;
}

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
                await uploadFilesSequential(node, Array.from(e.target.files || []), { replace });
            } catch (err) {
                console.error("上传失败:", err);
            } finally {
                document.body.removeChild(input);
                resolve();
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
                    return [...allowExt].some((ext) => name.endsWith(ext));
                });
                files.sort((a, b) =>
                    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
                );
                await uploadFilesSequential(node, files, { replace });
            } catch (err) {
                console.error("文件夹上传失败:", err);
            } finally {
                document.body.removeChild(input);
                resolve();
            }
        };
        input.click();
    });
}

async function queueAllSequential(node) {
    const names = parseImageList(getImageListWidget(node)?.value);
    if (names.length === 0) {
        alert("没有图片可队列");
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

async function queueSelectedSequential(node, selectedFiles) {
    const names = parseImageList(getImageListWidget(node)?.value);
    const toQueue = names.filter((n) => selectedFiles.has(n));
    if (toQueue.length === 0) {
        alert("请至少选择一张图片");
        return;
    }

    const modeWidget = node.widgets?.find((w) => w.name === "mode");
    const indexWidget = node.widgets?.find((w) => w.name === "index");

    if (modeWidget) {
        modeWidget.value = "single";
        modeWidget.callback?.("single");
    }

    for (const name of toQueue) {
        const idx = names.indexOf(name);
        if (idx !== -1 && indexWidget) {
            indexWidget.value = idx;
            indexWidget.callback?.(idx);
        }
        await app.queuePrompt();
    }
}

app.registerExtension({
    name: "Kinrol.BatchLoadImages.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KinrolBatchLoadImages") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);

            try {
                const imageListWidget = getImageListWidget(this);
                if (!imageListWidget) {
                    console.warn("KinrolBatchLoadImages: image_list widget not found");
                    return r;
                }

                imageListWidget.computeSize = () => [0, 130];

                setTimeout(() => {
                    const widgetEl = imageListWidget.inputEl || imageListWidget.element;
                    if (widgetEl) {
                        widgetEl.style.height = "120px";
                        widgetEl.style.overflow = "auto";
                        widgetEl.style.resize = "none";
                    }
                }, 0);

                const container = document.createElement("div");
                container.className = "kinrol-batch-load-container";
                container.style.cssText = `
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    padding: 4px 8px;
                    background: var(--comfy-menu-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    margin-top: -10px;
                    box-sizing: border-box;
                `;

                const btnRow = document.createElement("div");
                btnRow.style.cssText = `display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;`;

                const mkBtn = (label, onClick) => {
                    const b = document.createElement("button");
                    b.textContent = label;
                    b.style.cssText = `
                        flex: 1;
                        min-width: 50px;
                        padding: 4px 6px;
                        background: var(--comfy-input-bg);
                        color: var(--input-text);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    `;
                    b.onclick = onClick;
                    return b;
                };

                let selectedFiles = new Set();

                btnRow.appendChild(mkBtn("选择图片", () => openMultiSelect(this, { replace: true })));
                btnRow.appendChild(mkBtn("添加图片", () => openMultiSelect(this, { replace: false })));
                btnRow.appendChild(mkBtn("选择文件夹", () => openFolderSelect(this, { replace: true })));
                btnRow.appendChild(mkBtn("全部队列", () => queueAllSequential(this)));
                btnRow.appendChild(mkBtn("队列选中", () => queueSelectedSequential(this, selectedFiles)));
                btnRow.appendChild(mkBtn("删除选中", () => {
                    const names = parseImageList(imageListWidget.value);
                    const remaining = names.filter((n) => !selectedFiles.has(n));
                    selectedFiles.clear();
                    setImageList(this, remaining);
                }));
                btnRow.appendChild(mkBtn("取消选择", () => {
                    selectedFiles.clear();
                    updateGrid();
                }));
                btnRow.appendChild(mkBtn("清空", () => {
                    selectedFiles.clear();
                    setImageList(this, []);
                }));

                container.appendChild(btnRow);

                const infoRow = document.createElement("div");
                infoRow.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    flex-wrap: wrap;
                    gap: 8px;
                `;

                const info = document.createElement("div");
                info.style.cssText = `font-size: 11px; opacity: 0.8;`;

                const sizeControl = document.createElement("div");
                sizeControl.style.cssText = `display: flex; align-items: center; gap: 4px; font-size: 11px;`;
                const sizeLabel = document.createElement("span");
                sizeLabel.textContent = "尺寸:";
                const sizeSlider = document.createElement("input");
                sizeSlider.type = "range";
                sizeSlider.min = 60;
                sizeSlider.max = 200;
                sizeSlider.value = 100;
                sizeSlider.style.cssText = `width: 60px;`;
                const sizeValue = document.createElement("span");
                sizeValue.style.cssText = `min-width: 35px; text-align: right;`;
                sizeValue.textContent = "100px";
                sizeControl.appendChild(sizeLabel);
                sizeControl.appendChild(sizeSlider);
                sizeControl.appendChild(sizeValue);

                infoRow.appendChild(info);
                infoRow.appendChild(sizeControl);

                container.appendChild(infoRow);

                const grid = document.createElement("div");
                grid.className = "kinrol-thumb-grid";
                grid.style.cssText = `
                    display: none;
                    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                    gap: 8px;
                    overflow-y: auto;
                    background: var(--comfy-input-bg);
                    padding: 8px;
                    border-radius: 4px;
                    flex: 1;
                    min-height: 0;
                    margin-top: 8px;
                    user-select: none;
                `;

                const updateGrid = () => {
                    const names = parseImageList(imageListWidget.value);
                    grid.innerHTML = "";

                    if (names.length === 0) {
                        grid.style.display = "none";
                        selectedFiles.clear();
                        info.textContent = "没有图片";
                        return;
                    }

                    grid.style.display = "grid";
                    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${sizeSlider.value}px, 1fr))`;

                    info.textContent = `${names.length} 张图片${selectedFiles.size > 0 ? ` (已选${selectedFiles.size}张)` : ""}`;

                    names.forEach((name, idx) => {
                        const cell = document.createElement("div");
                        cell.className = "kinrol-thumb-cell";
                        cell.dataset.filename = name;
                        cell.style.cssText = `display: flex; flex-direction: column; gap: 2px;`;

                        const thumb = document.createElement("div");
                        thumb.style.cssText = `
                            position: relative;
                            border-radius: 4px;
                            overflow: hidden;
                            border: 2px solid ${selectedFiles.has(name) ? "#4a6" : "transparent"};
                            background: #000;
                            width: 100%;
                            aspect-ratio: 1;
                        `;

                        const img = document.createElement("img");
                        img.src = `/view?filename=${encodeURIComponent(name)}&type=input&subfolder=`;
                        img.alt = name;
                        img.loading = "lazy";
                        img.style.cssText = `width: 100%; height: 100%; object-fit: contain;`;

                        const label = document.createElement("div");
                        label.textContent = name;
                        label.title = name;
                        label.style.cssText = `font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

                        const del = document.createElement("button");
                        del.textContent = "×";
                        del.title = "删除";
                        del.style.cssText = `
                            position: absolute;
                            top: 1px;
                            right: 1px;
                            width: 16px;
                            height: 16px;
                            background: rgba(255, 0, 0, 0.75);
                            color: #fff;
                            border: none;
                            border-radius: 2px;
                            cursor: pointer;
                            font-size: 12px;
                            line-height: 1;
                        `;
                        del.onclick = (e) => {
                            e.stopPropagation();
                            const currentNames = parseImageList(imageListWidget.value);
                            const next = currentNames.slice(0, idx).concat(currentNames.slice(idx + 1));
                            selectedFiles.delete(name);
                            setImageList(this, next);
                        };

                        thumb.appendChild(img);
                        thumb.appendChild(del);
                        cell.appendChild(thumb);
                        cell.appendChild(label);
                        grid.appendChild(cell);
                    });
                };

                const prevCallback = imageListWidget.callback;
                imageListWidget.callback = (value) => {
                    prevCallback?.(value);
                    updateGrid();
                };

                sizeSlider.addEventListener("input", () => {
                    sizeValue.textContent = sizeSlider.value + "px";
                    updateGrid();
                });

                // Click selection
                grid.addEventListener("click", (e) => {
                    const cell = e.target.closest(".kinrol-thumb-cell");
                    if (cell && !e.target.closest("button")) {
                        const filename = cell.dataset.filename;
                        if (selectedFiles.has(filename)) {
                            selectedFiles.delete(filename);
                        } else {
                            selectedFiles.add(filename);
                        }
                        updateGrid();
                    }
                });

                // Box selection
                const DRAG_THRESHOLD = 3;
                let selectionRect = null;
                let startX = 0, startY = 0;
                let isSelecting = false;

                grid.addEventListener("mousedown", (e) => {
                    if (e.button !== 0 || e.target.closest("button")) return;
                    e.preventDefault();
                    startX = e.clientX;
                    startY = e.clientY;
                    isSelecting = false;

                    const onMouseMove = (e) => {
                        const dx = e.clientX - startX;
                        const dy = e.clientY - startY;

                        if (!isSelecting && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                            isSelecting = true;
                            selectionRect = document.createElement("div");
                            selectionRect.style.cssText = `
                                position: fixed;
                                border: 2px dashed #4a6;
                                background: rgba(74, 170, 102, 0.15);
                                pointer-events: none;
                                z-index: 9999;
                                left: ${startX}px;
                                top: ${startY}px;
                                width: 0;
                                height: 0;
                            `;
                            document.body.appendChild(selectionRect);
                        }

                        if (isSelecting && selectionRect) {
                            e.preventDefault();
                            const left = Math.min(startX, e.clientX);
                            const top = Math.min(startY, e.clientY);
                            selectionRect.style.left = `${left}px`;
                            selectionRect.style.top = `${top}px`;
                            selectionRect.style.width = `${Math.abs(e.clientX - startX)}px`;
                            selectionRect.style.height = `${Math.abs(e.clientY - startY)}px`;
                        }
                    };

                    const onMouseUp = (e) => {
                        if (isSelecting && selectionRect) {
                            const rect = selectionRect.getBoundingClientRect();
                            const thumbCells = grid.querySelectorAll(".kinrol-thumb-cell");

                            const insideFiles = new Set();
                            thumbCells.forEach((cell) => {
                                const cellRect = cell.getBoundingClientRect();
                                if (!(rect.right < cellRect.left || rect.left > cellRect.right ||
                                    rect.bottom < cellRect.top || rect.top > cellRect.bottom)) {
                                    insideFiles.add(cell.dataset.filename);
                                }
                            });

                            if (insideFiles.size > 0) {
                                const allInside = [...insideFiles].every(f => selectedFiles.has(f));
                                if (allInside) {
                                    insideFiles.forEach(f => selectedFiles.delete(f));
                                } else {
                                    insideFiles.forEach(f => selectedFiles.add(f));
                                }
                                updateGrid();
                            }

                            selectionRect.remove();
                            selectionRect = null;
                        }

                        document.removeEventListener("mousemove", onMouseMove);
                        document.removeEventListener("mouseup", onMouseUp);
                        isSelecting = false;
                    };

                    document.addEventListener("mousemove", onMouseMove);
                    document.addEventListener("mouseup", onMouseUp);
                });

                // Drag and drop
                container.addEventListener("dragover", (e) => {
                    const dt = e.dataTransfer;
                    if (!dt || !Array.from(dt.types || []).includes("Files")) return;
                    e.preventDefault();
                    e.stopPropagation();
                    container.style.borderColor = "#4a6";
                });

                container.addEventListener("dragleave", () => {
                    container.style.borderColor = "var(--border-color)";
                });

                container.addEventListener("drop", async (e) => {
                    const dt = e.dataTransfer;
                    if (!dt || !Array.from(dt.types || []).includes("Files")) return;
                    e.preventDefault();
                    e.stopPropagation();
                    container.style.borderColor = "var(--border-color)";
                    await uploadFilesSequential(this, Array.from(dt.files || []), { replace: false });
                });

                container.appendChild(grid);

                setTimeout(() => updateGrid(), 50);

                if (typeof this.addDOMWidget === 'function') {
                    const domWidget = this.addDOMWidget("kinrol_batch_load_images", "customwidget", container);
                    
                    const updateContainerHeight = () => {
                        // 延迟一帧确保 DOM 已经挂载并渲染
                        requestAnimationFrame(() => {
                            if (!container.parentElement) return;
                            
                            // 获取挂件在节点内部的 y 偏移
                            // last_y 是 ComfyUI 挂件系统记录的 y 坐标
                            const y = domWidget.last_y || 0;
                            const nodeHeight = this.size[1];
                            
                            // 计算剩余可用高度，预留一定的 margin (例如 15px)
                            const availableHeight = nodeHeight - y - 15;
                            const finalHeight = Math.max(100, availableHeight);
                            
                            container.style.height = `${finalHeight}px`;
                        });
                    };

                    // 使 DOM 挂件能够响应节点缩放，计算高度以填满节点底部
                    domWidget.computeSize = (width) => {
                        // 告知系统我们需要填满剩余空间，但不要定死高度，以便节点可以缩小
                        return [width, 100]; 
                    };

                    const origOnResize = this.onResize;
                    this.onResize = function(size) {
                        origOnResize?.apply(this, arguments);
                        updateContainerHeight();
                    };

                    // 初始化时调用一次
                    updateContainerHeight();
                }

                if (typeof this.setSize === 'function') {
                    this.setSize([620, 620]);
                }

            } catch (e) {
                console.error("KinrolBatchLoadImages error:", e);
            }

            return r;
        };
    },
});