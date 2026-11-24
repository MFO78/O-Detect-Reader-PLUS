'use strict';

        /* =========================================================================
         * Application State & UI Element References
         * ========================================================================= */
        const State = {
            originalRawPoints: [],          // Unmodified source XYZ points
            rawPoints: [],                  // Points after X/Y sign inversion
            sourceFileName: null,           // Original filename of loaded XYZ input
            sourceFileText: null,           // Raw text content of loaded XYZ input
            lastDirHandle: null,            // Remembered FileSystemDirectoryHandle for folder export
            autoSigmaOnNextProcess: false,  // Automates blue σ recalculation on file/config load
            apertures: [],                  // Grouped point arrays per aperture
            pointToApertureMap: [],         // Maps raw point index -> parent aperture index
            aperturePointRanges: [],        // Maps aperture index -> { start, end } in rawPoints
            centroids: [],                  // Centroid {x, y, z} per aperture
            xSteps: [],
            ySteps: [],
            angles: [],
            targetNeighbors: [],
            bbWidths: [],
            bbHeights: [],
            dimensionCharts: 0,
            customDims: {},
            refStep: { dx: 0, dy: 0 },
            latticeVector: { dx: 1, dy: 0 },
            discoveredAxes: [],             // Multi-axis lattice candidates [{ dx, dy, dist, angleDeg, count }]
            selectedAxisIndex: 'auto',      // 'auto' or numeric index into discoveredAxes
            targetAngle: null,              // Optional user target angle in degrees
            units: 'mm',
            outOfTolApertures: { notice: new Set(), warn: new Set(), critical: new Set() },
            overviewView: 'xy',
            isEqualAxes: true,
            metricFails: {},
            activeFailFilters: new Set(),
            knownMetrics: new Set(),
            metricsData: {},
            hiddenCharts: new Set(),
            logoDataUrl: null,
            logoFormat: null,
            active2DCharts: new Set(['plotStepX', 'plotStepY', 'plotAngle', 'plotBBX', 'plotBBY']),
            isSyncingZoom: false,
            chartTitles: {}
        };

        const UI = {
            fileInput: document.getElementById('fileInput'),
            loadedFileName: document.getElementById('loadedFileName'),
            btnLoadSample: document.getElementById('btnLoadSample'),
            btnProcess: document.getElementById('btnProcess'),
            btnToggleSidebar: document.getElementById('btnToggleSidebar'),
            sidebarBackdrop: document.getElementById('sidebarBackdrop'),
            selLayoutMode: document.getElementById('selLayoutMode'),
            selUnits: document.getElementById('selUnits'),
            selLatticeAxis: document.getElementById('selLatticeAxis'),
            inpTargetAngle: document.getElementById('inpTargetAngle'),
            appSidebar: document.getElementById('appSidebar'),
            layoutWrapper: document.getElementById('layoutWrapper'),
            chartsScrollContainer: document.getElementById('chartsScrollContainer'),
            plotOverview: document.getElementById('plotOverview'),
            inpThreshold: document.getElementById('inpThreshold'),
            inpPartNum: document.getElementById('inpPartNum'),
            inpSerialNum: document.getElementById('inpSerialNum'),
            inpComments: document.getElementById('inpComments'),
            welcomeScreen: document.getElementById('welcomeScreen'),
            cardOverview: document.getElementById('cardOverview'),
            cardSteps: document.getElementById('cardSteps'),
            cardBB: document.getElementById('cardBB'),
            cardDimensions: document.getElementById('cardDimensions'),
            summaryPanel: document.getElementById('summaryPanel'),
            statTotalPoints: document.getElementById('statTotalPoints'),
            statApertures: document.getElementById('statApertures'),
            selDimMode: document.getElementById('selDimMode'),
            selPointA: document.getElementById('selPointA'),
            selPointB: document.getElementById('selPointB'),
            selMetricType: document.getElementById('selMetricType'),
            btnAddDimension: document.getElementById('btnAddDimension'),
            dynamicChartsContainer: document.getElementById('dynamicChartsContainer'),
            emptyDimensionMsg: document.getElementById('emptyDimensionMsg'),
            btnEqualAxes: document.getElementById('btnEqualAxes'),
            btnDownloadPDF: document.getElementById('btnDownloadPDF'),
            btnExportToFolder: document.getElementById('btnExportToFolder'),
            savedFolderBar: document.getElementById('savedFolderBar'),
            savedFolderName: document.getElementById('savedFolderName'),
            btnChangeExportFolder: document.getElementById('btnChangeExportFolder'),
            exportPanel: document.getElementById('exportPanel'),
            chkShowLabels: document.getElementById('chkShowLabels'),
            chkHighlightTol: document.getElementById('chkHighlightTol'),
            inpMarkerColor: document.getElementById('inpMarkerColor'),
            inpCentroidColor: document.getElementById('inpCentroidColor'),
            inpMarkerSize: document.getElementById('inpMarkerSize'),
            inpCentroidSize: document.getElementById('inpCentroidSize'),
            inpLogoUpload: document.getElementById('inpLogoUpload'),
            logoPreviewContainer: document.getElementById('logoPreviewContainer'),
            logoPreview: document.getElementById('logoPreview'),
            btnRemoveLogo: document.getElementById('btnRemoveLogo'),
            inpCompanyName: document.getElementById('inpCompanyName'),
            inpAccentColor: document.getElementById('inpAccentColor'),
            sidebarCompanyText: document.getElementById('sidebarCompanyText')
        };

        /* =========================================================================
         * Utility Helpers
         * ========================================================================= */
        function debounce(fn, delay = 140) {
            let timer = null;
            return function(...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        }

        function getUnitSuffix() {
            return State.units ? ` ${State.units}` : '';
        }

        function getUnitBracket() {
            return State.units ? `[${State.units}]` : '';
        }

        function sanitizeFilenamePart(str) {
            return String(str || '')
                .trim()
                .replace(/[^a-zA-Z0-9._-]+/g, '_')
                .replace(/^_+|_+$/g, '');
        }

        function dataUrlToBlob(dataUrl) {
            const parts = dataUrl.split(',');
            const mimeMatch = parts[0].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const binary = atob(parts[1]);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
        }

        function hexToRgb(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : { r: 39, g: 97, b: 147 };
        }

        function showNotification(msg, type = 'info') {
            let toast = document.getElementById('toastNotification');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toastNotification';
                toast.className = 'fixed top-4 right-4 z-[100] transition-all pointer-events-none flex flex-col items-end gap-2 max-w-sm';
                document.body.appendChild(toast);
            }
            const colorClass = type === 'error'
                ? 'bg-red-600 text-white'
                : type === 'success'
                    ? 'bg-emerald-600 text-white'
                    : type === 'warning'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-800 dark:bg-slate-200 dark:text-slate-900 text-white';
            const iconClass = type === 'error'
                ? 'fa-triangle-exclamation'
                : type === 'success'
                    ? 'fa-circle-check'
                    : type === 'warning'
                        ? 'fa-circle-exclamation'
                        : 'fa-circle-info';

            const el = document.createElement('div');
            el.className = `px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold transition-opacity duration-300 flex items-center gap-2 ${colorClass}`;
            const icon = document.createElement('i');
            icon.className = `fa-solid ${iconClass} shrink-0`;
            const span = document.createElement('span');
            span.textContent = msg;
            el.appendChild(icon);
            el.appendChild(span);
            toast.appendChild(el);

            setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 300);
            }, 3400);
        }

        function isRawPointsChart(plotId) {
            if (!plotId.startsWith('dimChart_')) return false;
            const cfg = State.customDims[plotId]?.config;
            return Boolean(cfg && cfg.mode === 'raw_points');
        }

        /* =========================================================================
         * Sidebar Drawer, Theme, Units & Layout Controls
         * ========================================================================= */
        function closeMobileSidebar() {
            UI.appSidebar.classList.add('-translate-x-full');
            UI.sidebarBackdrop.classList.add('hidden');
        }
        window.closeMobileSidebar = closeMobileSidebar;

        function toggleSidebar() {
            if (window.innerWidth < 768) {
                const isClosed = UI.appSidebar.classList.contains('-translate-x-full');
                if (isClosed) {
                    UI.appSidebar.classList.remove('-translate-x-full');
                    UI.sidebarBackdrop.classList.remove('hidden');
                } else {
                    closeMobileSidebar();
                }
            } else {
                UI.appSidebar.classList.toggle('md:hidden');
                setTimeout(() => resizeAllPlots(), 120);
            }
        }

        function toggleTheme() {
            document.documentElement.classList.toggle('dark');
            updateAllChartsTheme();
        }
        window.toggleTheme = toggleTheme;

        function onUnitChange() {
            State.units = UI.selUnits.value;
            if (State.rawPoints && State.rawPoints.length > 0) {
                renderStepPlots({ skipOverview: true });
                renderBBPlots({ skipOverview: true });
                for (const chartDivId in State.customDims) {
                    const idx = parseInt(chartDivId.split('_')[1], 10);
                    renderCustomDimChart(idx, { skipOverview: true });
                }
                update3DOverview();
            }
        }
        window.onUnitChange = onUnitChange;

        function getThemeLayout() {
            const isDark = document.documentElement.classList.contains('dark');
            return {
                paper_bgcolor: isDark ? '#1e293b' : '#ffffff',
                plot_bgcolor: isDark ? '#0f172a' : '#f8fafc',
                fontColor: isDark ? '#cbd5e1' : '#334155',
                gridColor: isDark ? '#334155' : '#e2e8f0',
                zeroLineColor: isDark ? '#475569' : '#cbd5e1'
            };
        }

        function get2DMarkerSize() {
            const el = document.getElementById('inp2DMarkerSize');
            return el ? (parseInt(el.value, 10) || 4) : 4;
        }

        function getExportFontSize() {
            const el = document.getElementById('inpExportFontSize');
            const val = el ? parseFloat(el.value) : 20;
            return (!isNaN(val) && val >= 10 && val <= 48) ? val : 20;
        }

        function getChartTitle(plotId, fallback = '') {
            const inputEl = document.getElementById(`title_${plotId}`);
            if (inputEl && inputEl.value.trim()) return inputEl.value.trim();
            if (State.chartTitles[plotId] && State.chartTitles[plotId].trim()) return State.chartTitles[plotId].trim();
            if (State.customDims[plotId] && State.customDims[plotId].title) return State.customDims[plotId].title;
            return fallback || plotId;
        }

        function onChartTitleChange(plotId, value) {
            const trimmed = String(value || '').trim();
            State.chartTitles[plotId] = trimmed;
            if (State.customDims[plotId]) {
                State.customDims[plotId].title = trimmed || State.customDims[plotId].defaultTitle || plotId;
            }
        }
        window.onChartTitleChange = onChartTitleChange;

        function getAllChartTitles() {
            const titles = {};
            const defaultIds = ['plotOverview', 'plotStepX', 'plotStepY', 'plotAngle', 'plotBBX', 'plotBBY'];
            defaultIds.forEach(id => {
                const el = document.getElementById(`title_${id}`);
                if (el) titles[id] = el.value.trim();
            });
            for (const id in State.customDims) {
                titles[id] = getChartTitle(id, State.customDims[id].title);
            }
            return titles;
        }

        function update2DCharts() {
            if (!State.rawPoints || State.rawPoints.length === 0) return;
            renderStepPlots({ skipOverview: true });
            renderBBPlots({ skipOverview: true });
            for (const chartDivId in State.customDims) {
                const idx = parseInt(chartDivId.split('_')[1], 10);
                renderCustomDimChart(idx, { skipOverview: true });
            }
        }
        window.update2DCharts = update2DCharts;

        function updateAllChartsTheme() {
            const theme = getThemeLayout();
            const layoutUpdate = {
                paper_bgcolor: theme.paper_bgcolor,
                plot_bgcolor: theme.plot_bgcolor,
                'font.color': theme.fontColor,
                'xaxis.gridcolor': theme.gridColor,
                'yaxis.gridcolor': theme.gridColor,
                'xaxis.zerolinecolor': theme.zeroLineColor,
                'yaxis.zerolinecolor': theme.zeroLineColor
            };

            const plots = ['plotOverview', 'plotStepX', 'plotStepY', 'plotAngle', 'plotBBX', 'plotBBY'];
            plots.forEach(id => {
                const el = document.getElementById(id);
                if (el && el.layout) {
                    if (el.layout.scene) {
                        const sceneUpdate = {
                            'scene.xaxis.gridcolor': theme.gridColor,
                            'scene.yaxis.gridcolor': theme.gridColor,
                            'scene.zaxis.gridcolor': theme.gridColor,
                            'scene.xaxis.backgroundcolor': theme.plot_bgcolor,
                            'scene.yaxis.backgroundcolor': theme.plot_bgcolor,
                            'scene.zaxis.backgroundcolor': theme.plot_bgcolor
                        };
                        Plotly.relayout(id, { ...layoutUpdate, ...sceneUpdate });
                    } else {
                        Plotly.relayout(id, layoutUpdate);
                    }
                }
            });

            // Re-render overview if labels are shown so textfont matches the new theme
            if (State.rawPoints.length > 0 && UI.chkShowLabels.checked) {
                renderOverviewPlot();
            }

            document.querySelectorAll('[id^="dimChart_"]').forEach(chart => {
                if (chart.layout) Plotly.relayout(chart.id, layoutUpdate);
            });
        }

        function updateLayoutMode() {
            const mode = UI.selLayoutMode.value;
            const mainContainer = document.getElementById('mainContainer');
            const wrapper = UI.layoutWrapper;
            const overview = UI.cardOverview;
            const scrollContainer = UI.chartsScrollContainer;
            const steps = UI.cardSteps;
            const bb = UI.cardBB;
            const chartWrapper = document.getElementById('overviewChartWrapper');

            if (!State.rawPoints || State.rawPoints.length === 0) {
                wrapper.classList.add('hidden');
                overview.classList.add('hidden');
                overview.classList.remove('flex');
                steps.classList.add('hidden');
                bb.classList.add('hidden');
                return;
            } else {
                wrapper.classList.remove('hidden');
                overview.classList.remove('hidden');
                overview.classList.add('flex');
                steps.classList.remove('hidden');
                bb.classList.remove('hidden');
            }

            overview.className = 'glass-panel rounded-lg p-4 shadow-sm flex flex-col transition-colors z-20 overflow-hidden shrink-0';
            scrollContainer.className = 'flex flex-col gap-6 transition-colors w-full';
            steps.className = 'grid gap-6 chart-controls transition-colors';
            bb.className = 'grid gap-6 chart-controls transition-colors';

            overview.style.top = '';
            overview.style.width = '';
            overview.style.height = '';

            if (mode === 'grid' || mode === 'full') {
                mainContainer.classList.add('overflow-y-auto');
                mainContainer.classList.remove('overflow-hidden');
                wrapper.className = 'flex flex-col gap-6 w-full min-h-full relative';

                if (mode === 'grid') {
                    overview.classList.add('w-full', 'resize-y');
                    overview.style.height = '48vh';
                    overview.style.minHeight = '320px';
                    scrollContainer.classList.add('w-full');
                    steps.classList.add('grid-cols-1', 'xl:grid-cols-3');
                    bb.classList.add('grid-cols-1', 'lg:grid-cols-2');
                    chartWrapper.className = 'relative w-full max-w-[900px] mx-auto flex-1 mt-2';
                } else {
                    overview.classList.add('w-full', 'resize-y');
                    overview.style.height = '60vh';
                    overview.style.minHeight = '400px';
                    scrollContainer.classList.add('w-full');
                    steps.classList.add('grid-cols-1');
                    bb.classList.add('grid-cols-1');
                    chartWrapper.className = 'relative w-full flex-1 mt-2';
                }
            } else {
                mainContainer.classList.remove('overflow-y-auto');
                mainContainer.classList.add('overflow-hidden');
                wrapper.className = 'flex flex-col lg:flex-row gap-6 w-full flex-1 min-h-0 relative items-start';
                scrollContainer.classList.add('flex-1', 'h-full', 'overflow-y-auto', 'custom-scrollbar', 'pr-2', 'pb-10');

                if (mode === 'split') {
                    overview.classList.add('w-full', 'lg:w-[45%]', 'h-[40vh]', 'lg:h-full', 'resize-y', 'lg:resize-x');
                    steps.classList.add('grid-cols-1');
                    bb.classList.add('grid-cols-1');
                    chartWrapper.className = 'relative w-full flex-1 mt-2 h-full';
                } else {
                    wrapper.classList.remove('lg:flex-row');
                    overview.classList.add('w-full', 'h-[45vh]', 'resize-y');
                    steps.classList.add('grid-cols-1', 'xl:grid-cols-3');
                    bb.classList.add('grid-cols-1', 'lg:grid-cols-2');
                    chartWrapper.className = 'relative w-full flex-1 mt-2 h-full';
                }
            }

            setTimeout(() => resizeAllPlots(), 100);
        }

        function updateEqualAxesButtonUI() {
            if (State.isEqualAxes) {
                UI.btnEqualAxes.classList.remove('bg-slate-200', 'text-slate-700', 'dark:bg-slate-600', 'dark:text-slate-200');
                UI.btnEqualAxes.classList.add('bg-blue-100', 'text-blue-700', 'dark:bg-blue-900/50', 'dark:text-blue-300');
            } else {
                UI.btnEqualAxes.classList.remove('bg-blue-100', 'text-blue-700', 'dark:bg-blue-900/50', 'dark:text-blue-300');
                UI.btnEqualAxes.classList.add('bg-slate-200', 'text-slate-700', 'dark:bg-slate-600', 'dark:text-slate-200');
            }
        }

        function toggleEqualAxes() {
            State.isEqualAxes = !State.isEqualAxes;
            updateEqualAxesButtonUI();
            renderOverviewPlot();
        }

        /* =========================================================================
         * Cross-Chart Bidirectional Zoom Synchronization
         * ========================================================================= */
        function bindZoomSync(plotId) {
            const el = document.getElementById(plotId);
            if (!el || el._hasZoomSync) return;

            el.on('plotly_relayout', (eventData) => {
                if (State.isSyncingZoom) return;

                const isAuto = eventData['xaxis.autorange'] === true;
                let r0, r1;
                if (eventData['xaxis.range[0]'] !== undefined) {
                    r0 = Number(eventData['xaxis.range[0]']);
                    r1 = Number(eventData['xaxis.range[1]']);
                } else if (eventData['xaxis.range'] !== undefined) {
                    r0 = Number(eventData['xaxis.range'][0]);
                    r1 = Number(eventData['xaxis.range'][1]);
                } else if (!isAuto) {
                    return;
                }

                State.isSyncingZoom = true;
                const sourceIsRaw = isRawPointsChart(plotId);
                const promises = [];

                // Translate source range to both aperture index range and raw point index range
                let apRange = null;
                let rawRange = null;

                if (!isAuto && State.apertures.length > 0 && State.rawPoints.length > 0) {
                    if (sourceIsRaw) {
                        rawRange = [r0, r1];
                        const pStart = Math.max(0, Math.min(State.rawPoints.length - 1, Math.floor(r0)));
                        const pEnd = Math.max(0, Math.min(State.rawPoints.length - 1, Math.ceil(r1)));
                        let minAp = Infinity, maxAp = -Infinity;
                        for (let i = pStart; i <= pEnd; i++) {
                            const apIdx = State.pointToApertureMap[i];
                            if (apIdx !== undefined) {
                                if (apIdx < minAp) minAp = apIdx;
                                if (apIdx > maxAp) maxAp = apIdx;
                            }
                        }
                        if (minAp !== Infinity) apRange = [minAp - 0.5, maxAp + 0.5];
                    } else {
                        apRange = [r0, r1];
                        const aStart = Math.max(0, Math.min(State.apertures.length - 1, Math.floor(r0)));
                        const aEnd = Math.max(0, Math.min(State.apertures.length - 1, Math.ceil(r1)));
                        if (aStart <= aEnd && State.aperturePointRanges[aStart] && State.aperturePointRanges[aEnd]) {
                            rawRange = [
                                State.aperturePointRanges[aStart].start - 0.5,
                                State.aperturePointRanges[aEnd].end + 0.5
                            ];
                        }
                    }
                }

                // 1. Sync all other 2D charts with domain-appropriate X range
                State.active2DCharts.forEach(id => {
                    if (id === plotId || State.hiddenCharts.has(id)) return;
                    const otherEl = document.getElementById(id);
                    if (!otherEl) return;

                    if (isAuto) {
                        promises.push(Plotly.relayout(id, { 'xaxis.autorange': true }).catch(() => {}));
                    } else {
                        const targetRange = isRawPointsChart(id) ? rawRange : apRange;
                        if (targetRange) {
                            promises.push(Plotly.relayout(id, { 'xaxis.range': targetRange }).catch(() => {}));
                        }
                    }
                });

                // 2. Sync 3D/2D overview explicitly to physical extents of visible points
                const overviewEl = document.getElementById('plotOverview');
                if (overviewEl && State.apertures.length > 0) {
                    const update3D = {};
                    if (isAuto) {
                        if (State.overviewView === 'iso') {
                            update3D['scene.xaxis.autorange'] = true;
                            update3D['scene.yaxis.autorange'] = true;
                            update3D['scene.zaxis.autorange'] = true;
                        } else {
                            update3D['xaxis.autorange'] = true;
                            update3D['yaxis.autorange'] = true;
                        }
                    } else {
                        let cMinX = Infinity, cMaxX = -Infinity;
                        let cMinY = Infinity, cMaxY = -Infinity;
                        let cMinZ = Infinity, cMaxZ = -Infinity;
                        let foundAny = false;

                        const sIdx = Math.max(0, Math.floor(r0));
                        const maxIdx = sourceIsRaw ? State.rawPoints.length - 1 : State.apertures.length - 1;
                        const eIdx = Math.min(maxIdx, Math.ceil(r1));

                        if (sIdx <= eIdx && sIdx >= 0) {
                            if (sourceIsRaw) {
                                for (let i = sIdx; i <= eIdx; i++) {
                                    const pt = State.rawPoints[i];
                                    if (!pt) continue;
                                    if (pt.x < cMinX) cMinX = pt.x;
                                    if (pt.x > cMaxX) cMaxX = pt.x;
                                    if (pt.y < cMinY) cMinY = pt.y;
                                    if (pt.y > cMaxY) cMaxY = pt.y;
                                    if (pt.z < cMinZ) cMinZ = pt.z;
                                    if (pt.z > cMaxZ) cMaxZ = pt.z;
                                    foundAny = true;
                                }
                            } else {
                                for (let i = sIdx; i <= eIdx; i++) {
                                    const ap = State.apertures[i];
                                    if (!ap) continue;
                                    for (const pt of ap) {
                                        if (pt.x < cMinX) cMinX = pt.x;
                                        if (pt.x > cMaxX) cMaxX = pt.x;
                                        if (pt.y < cMinY) cMinY = pt.y;
                                        if (pt.y > cMaxY) cMaxY = pt.y;
                                        if (pt.z < cMinZ) cMinZ = pt.z;
                                        if (pt.z > cMaxZ) cMaxZ = pt.z;
                                        foundAny = true;
                                    }
                                }
                            }
                        }

                        if (foundAny) {
                            let dx = cMaxX - cMinX;
                            let dy = cMaxY - cMinY;
                            let dz = cMaxZ - cMinZ;
                            if (dx < 1e-5) { cMinX -= 0.5; cMaxX += 0.5; dx = 1; }
                            if (dy < 1e-5) { cMinY -= 0.5; cMaxY += 0.5; dy = 1; }
                            if (dz < 1e-5) { cMinZ -= 0.5; cMaxZ += 0.5; dz = 1; }

                            const padX = Math.max(dx * 0.1, 0.05 * Math.max(dx, dy, 1));
                            const padY = Math.max(dy * 0.1, 0.05 * Math.max(dx, dy, 1));
                            const padZ = Math.max(dz * 0.1, 0.05 * Math.max(dx, dy, dz, 1));

                            if (State.overviewView === 'iso') {
                                update3D['scene.xaxis.range'] = [cMinX - padX, cMaxX + padX];
                                update3D['scene.yaxis.range'] = [cMinY - padY, cMaxY + padY];
                                update3D['scene.zaxis.range'] = [cMinZ - padZ, cMaxZ + padZ];
                            } else if (State.overviewView === 'xy') {
                                update3D['xaxis.range'] = [cMinX - padX, cMaxX + padX];
                                update3D['yaxis.range'] = [cMinY - padY, cMaxY + padY];
                            } else if (State.overviewView === 'xz') {
                                update3D['xaxis.range'] = [cMinX - padX, cMaxX + padX];
                                update3D['yaxis.range'] = [cMinZ - padZ, cMaxZ + padZ];
                            } else if (State.overviewView === 'yz') {
                                update3D['xaxis.range'] = [cMinY - padY, cMaxY + padY];
                                update3D['yaxis.range'] = [cMinZ - padZ, cMaxZ + padZ];
                            }
                        }
                    }

                    if (Object.keys(update3D).length > 0) {
                        promises.push(Plotly.relayout('plotOverview', update3D).catch(() => {}));
                    }
                }

                Promise.all(promises).then(() => {
                    setTimeout(() => { State.isSyncingZoom = false; }, 50);
                });
            });

            el._hasZoomSync = true;
        }

        function bindOverviewZoomSync() {
            const overviewEl = document.getElementById('plotOverview');
            if (!overviewEl || overviewEl._hasZoomSync) return;

            overviewEl.on('plotly_relayout', (eventData) => {
                if (State.isSyncingZoom) return;

                const isAuto = eventData['xaxis.autorange'] === true || eventData['scene.xaxis.autorange'] === true;
                let xMin = -Infinity, xMax = Infinity;
                let yMin = -Infinity, yMax = Infinity;
                let zMin = -Infinity, zMax = Infinity;
                let hasBounds = false;

                if (State.overviewView === 'iso') {
                    if (eventData['scene.xaxis.range[0]'] !== undefined) {
                        xMin = eventData['scene.xaxis.range[0]']; xMax = eventData['scene.xaxis.range[1]']; hasBounds = true;
                    } else if (eventData['scene.xaxis.range']) {
                        xMin = eventData['scene.xaxis.range'][0]; xMax = eventData['scene.xaxis.range'][1]; hasBounds = true;
                    }
                    if (eventData['scene.yaxis.range[0]'] !== undefined) {
                        yMin = eventData['scene.yaxis.range[0]']; yMax = eventData['scene.yaxis.range[1]']; hasBounds = true;
                    } else if (eventData['scene.yaxis.range']) {
                        yMin = eventData['scene.yaxis.range'][0]; yMax = eventData['scene.yaxis.range'][1]; hasBounds = true;
                    }
                    if (eventData['scene.zaxis.range[0]'] !== undefined) {
                        zMin = eventData['scene.zaxis.range[0]']; zMax = eventData['scene.zaxis.range[1]']; hasBounds = true;
                    } else if (eventData['scene.zaxis.range']) {
                        zMin = eventData['scene.zaxis.range'][0]; zMax = eventData['scene.zaxis.range'][1]; hasBounds = true;
                    }
                } else {
                    // Map 2D plot axes (xaxis, yaxis) to physical coordinates based on active projection
                    let axMin = -Infinity, axMax = Infinity, ayMin = -Infinity, ayMax = Infinity;
                    if (eventData['xaxis.range[0]'] !== undefined) {
                        axMin = eventData['xaxis.range[0]']; axMax = eventData['xaxis.range[1]']; hasBounds = true;
                    } else if (eventData['xaxis.range']) {
                        axMin = eventData['xaxis.range'][0]; axMax = eventData['xaxis.range'][1]; hasBounds = true;
                    }
                    if (eventData['yaxis.range[0]'] !== undefined) {
                        ayMin = eventData['yaxis.range[0]']; ayMax = eventData['yaxis.range[1]']; hasBounds = true;
                    } else if (eventData['yaxis.range']) {
                        ayMin = eventData['yaxis.range'][0]; ayMax = eventData['yaxis.range'][1]; hasBounds = true;
                    }

                    if (State.overviewView === 'xy') {
                        xMin = axMin; xMax = axMax; yMin = ayMin; yMax = ayMax;
                    } else if (State.overviewView === 'xz') {
                        xMin = axMin; xMax = axMax; zMin = ayMin; zMax = ayMax;
                    } else if (State.overviewView === 'yz') {
                        yMin = axMin; yMax = axMax; zMin = ayMin; zMax = ayMax;
                    }
                }

                if (!hasBounds && !isAuto) return;

                State.isSyncingZoom = true;
                let apUpdate = null;
                let rawUpdate = null;

                if (isAuto) {
                    apUpdate = { 'xaxis.autorange': true };
                    rawUpdate = { 'xaxis.autorange': true };
                } else {
                    let minIdx = Infinity, maxIdx = -Infinity;
                    State.centroids.forEach((c, idx) => {
                        const inX = c.x >= xMin && c.x <= xMax;
                        const inY = c.y >= yMin && c.y <= yMax;
                        const inZ = c.z >= zMin && c.z <= zMax;
                        let isVisible = false;
                        if (State.overviewView === 'xy') isVisible = inX && inY;
                        else if (State.overviewView === 'xz') isVisible = inX && inZ;
                        else if (State.overviewView === 'yz') isVisible = inY && inZ;
                        else isVisible = inX && inY && inZ;

                        if (isVisible) {
                            if (idx < minIdx) minIdx = idx;
                            if (idx > maxIdx) maxIdx = idx;
                        }
                    });

                    if (minIdx === Infinity) {
                        State.isSyncingZoom = false;
                        return;
                    }

                    apUpdate = { 'xaxis.range': [minIdx - 0.5, maxIdx + 0.5] };
                    if (State.aperturePointRanges[minIdx] && State.aperturePointRanges[maxIdx]) {
                        rawUpdate = {
                            'xaxis.range': [
                                State.aperturePointRanges[minIdx].start - 0.5,
                                State.aperturePointRanges[maxIdx].end + 0.5
                            ]
                        };
                    }
                }

                const promises = [];
                State.active2DCharts.forEach(id => {
                    const otherEl = document.getElementById(id);
                    if (otherEl && !State.hiddenCharts.has(id)) {
                        const upd = isRawPointsChart(id) ? rawUpdate : apUpdate;
                        if (upd) promises.push(Plotly.relayout(id, upd).catch(() => {}));
                    }
                });

                Promise.all(promises).then(() => {
                    setTimeout(() => { State.isSyncingZoom = false; }, 50);
                });
            });

            overviewEl._hasZoomSync = true;
        }

        /* =========================================================================
         * Data Parsing, Sample Generation, and Scale-Invariant Segmentation
         * ========================================================================= */
        function setLoadedFileDisplay(name) {
            if (!UI.loadedFileName) return;
            UI.loadedFileName.textContent = name || 'No file chosen';
            UI.loadedFileName.title = name || 'No file chosen';
            if (name) {
                UI.loadedFileName.classList.remove('text-slate-400', 'dark:text-slate-400');
                UI.loadedFileName.classList.add('text-slate-700', 'dark:text-slate-200', 'font-medium');
            } else {
                UI.loadedFileName.classList.add('text-slate-400', 'dark:text-slate-400');
                UI.loadedFileName.classList.remove('text-slate-700', 'dark:text-slate-200', 'font-medium');
            }
        }

        function handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const text = e.target.result;
                State.sourceFileName = file.name;
                State.sourceFileText = text;
                State.autoSigmaOnNextProcess = true;
                setLoadedFileDisplay(file.name);
                UI.btnProcess.classList.add('animate-pulse');
                setTimeout(() => UI.btnProcess.classList.remove('animate-pulse'), 1200);
                parseRawText(text);
                if (window.innerWidth < 768) closeMobileSidebar();
            };
            reader.readAsText(file);
            // Reset input value so reloading the exact same file always triggers change
            event.target.value = '';
        }

        function parseRawText(text) {
            const lines = text.trim().split(/\r?\n/);
            State.originalRawPoints = [];

            for (const line of lines) {
                const parts = line.trim().split(/[\s,;]+/);
                if (parts.length >= 3) {
                    const x = parseFloat(parts[0]);
                    const y = parseFloat(parts[1]);
                    const z = parseFloat(parts[2]);
                    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                        State.originalRawPoints.push({ x, y, z });
                    }
                }
            }

            if (State.originalRawPoints.length === 0) {
                showNotification("No valid numeric XYZ coordinates found in file.", "error");
                return;
            }
            showNotification(`Loaded ${State.originalRawPoints.length} valid XYZ points.`, 'success');
            applyModificationsAndProcess();
        }

        function applyModificationsAndProcess() {
            if (!State.originalRawPoints || State.originalRawPoints.length === 0) return;

            const invX = document.getElementById('chkInvertX').checked;
            const invY = document.getElementById('chkInvertY').checked;

            State.rawPoints = State.originalRawPoints.map(p => ({
                x: invX ? -p.x : p.x,
                y: invY ? -p.y : p.y,
                z: p.z
            }));

            processData();
        }
        window.applyModificationsAndProcess = applyModificationsAndProcess;

        function generateSampleData() {
            const gridRows = 4;
            const gridCols = 4;
            const pitchX = 24;
            const pitchY = 20;
            const staggerX = 12;

            // Closed-like 4-point aperture (max intra-aperture step = 8, inter-aperture jump >= 14)
            const baseShape = [
                { x: 0, y: 0, z: 0 },
                { x: 8, y: 0, z: 0 },
                { x: 8, y: 4, z: 0 },
                { x: 0, y: 4, z: 0 }
            ];

            let textData = "";
            for (let row = 0; row < gridRows; row++) {
                for (let col = 0; col < gridCols; col++) {
                    const rowOffset = (row % 2 !== 0) ? staggerX : 0;
                    const offsetX = (col * pitchX) + rowOffset;
                    const offsetY = row * pitchY;

                    for (const pt of baseShape) {
                        const noiseX = (Math.random() - 0.5) * 0.16;
                        const noiseY = (Math.random() - 0.5) * 0.16;
                        const noiseZ = (Math.random() - 0.5) * 0.04;

                        const outlierMult = (col === 2 && row === 1) ? 3.5 : 1;
                        const px = offsetX + pt.x + (noiseX * outlierMult);
                        const py = offsetY + pt.y + (noiseY * outlierMult);
                        const pz = pt.z + noiseZ;

                        textData += `${px.toFixed(4)}, ${py.toFixed(4)}, ${pz.toFixed(4)}\n`;
                    }
                }
            }

            UI.inpThreshold.value = '';
            State.sourceFileName = 'Sample_Data.txt';
            State.sourceFileText = textData;
            State.autoSigmaOnNextProcess = true;
            setLoadedFileDisplay('Sample_Data.txt');
            parseRawText(textData);
            if (window.innerWidth < 768) closeMobileSidebar();
        }
        window.generateSampleData = generateSampleData;

        /**
         * Scale-invariant aperture split threshold estimator using maximum log-ratio gap
         * in the upper half of consecutive point-to-point distances.
         */
        function detectAutoSplitThreshold(distances) {
            const positive = distances.filter(d => d > 1e-12).sort((a, b) => a - b);
            if (positive.length < 2) return (positive[0] || 1) * 2;

            const medianDist = positive[Math.floor(positive.length / 2)];
            let bestRatio = 1;
            let bestThreshold = null;

            // Scan for the sharpest multiplicative jump above 0.5x median
            const startIdx = Math.floor(positive.length * 0.25);
            for (let i = startIdx; i < positive.length - 1; i++) {
                const v1 = positive[i];
                const v2 = positive[i + 1];
                if (v1 < medianDist * 0.5) continue;
                const ratio = v2 / v1;
                if (ratio > bestRatio) {
                    bestRatio = ratio;
                    bestThreshold = Math.sqrt(v1 * v2); // Geometric midpoint (scale-invariant)
                }
            }

            if (bestThreshold !== null && bestRatio >= 1.35) {
                return bestThreshold;
            }
            return medianDist * 2.5;
        }

        /**
         * Multi-axis lattice discovery: collects all near-equidistant neighbors
         * (within 1.18x of each centroid's shortest spacing), normalizes them into
         * the positive half-plane, and clusters them into distinct basis directions
         * (e.g., +30°, -30°, and 90° for a hexagonal array).
         */
        function discoverLatticeAxes(centroids) {
            if (centroids.length < 2) return [];

            // 1. Find each centroid's minimum neighbor distance and global baseline
            const minDists = [];
            for (let i = 0; i < centroids.length; i++) {
                let minD = Infinity;
                for (let j = 0; j < centroids.length; j++) {
                    if (i === j) continue;
                    const dx = centroids[j].x - centroids[i].x;
                    const dy = centroids[j].y - centroids[i].y;
                    const d = Math.hypot(dx, dy);
                    if (d > 1e-9 && d < minD) minD = d;
                }
                if (isFinite(minD)) minDists.push(minD);
            }
            if (minDists.length === 0) return [];
            minDists.sort((a, b) => a - b);
            const baselineDist = minDists[Math.floor(minDists.length / 2)];
            const maxCandidateDist = baselineDist * 1.18;

            // 2. Collect all near-equidistant neighbor vectors in the positive half-plane
            const samples = [];
            for (let i = 0; i < centroids.length; i++) {
                for (let j = i + 1; j < centroids.length; j++) {
                    let dx = centroids[j].x - centroids[i].x;
                    let dy = centroids[j].y - centroids[i].y;
                    const dist = Math.hypot(dx, dy);
                    if (dist <= 1e-9 || dist > maxCandidateDist) continue;

                    // Canonicalize into positive-X half-plane (or positive-Y if vertical)
                    if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && dy < 0)) {
                        dx = -dx;
                        dy = -dy;
                    }
                    samples.push({
                        dx,
                        dy,
                        dist,
                        angleDeg: Math.atan2(dy, dx) * (180 / Math.PI)
                    });
                }
            }
            if (samples.length === 0) return [];

            // 3. Greedy angular + length clustering (within ±12° and ±20% length)
            const clusters = [];
            for (const s of samples) {
                let matched = null;
                let bestScore = Infinity;
                for (const c of clusters) {
                    const angDiff = Math.abs(s.angleDeg - c.angleDeg);
                    const lenRatio = Math.abs(s.dist - c.dist) / (c.dist || 1);
                    if (angDiff <= 12 && lenRatio <= 0.20) {
                        const score = angDiff + lenRatio * 50;
                        if (score < bestScore) {
                            bestScore = score;
                            matched = c;
                        }
                    }
                }
                if (matched) {
                    matched.items.push(s);
                    const n = matched.items.length;
                    matched.sumDx += s.dx;
                    matched.sumDy += s.dy;
                    matched.dx = matched.sumDx / n;
                    matched.dy = matched.sumDy / n;
                    matched.dist = Math.hypot(matched.dx, matched.dy);
                    matched.angleDeg = Math.atan2(matched.dy, matched.dx) * (180 / Math.PI);
                } else {
                    clusters.push({
                        items: [s],
                        sumDx: s.dx,
                        sumDy: s.dy,
                        dx: s.dx,
                        dy: s.dy,
                        dist: s.dist,
                        angleDeg: s.angleDeg
                    });
                }
            }

            // 4. Filter out noise clusters and sort by support count (then by smallest |angle|)
            const maxCount = Math.max(...clusters.map(c => c.items.length));
            const minSupport = Math.max(1, Math.floor(maxCount * 0.2));

            return clusters
                .filter(c => c.items.length >= minSupport)
                .map(c => ({
                    dx: c.dx,
                    dy: c.dy,
                    dist: c.dist,
                    angleDeg: c.angleDeg,
                    count: c.items.length
                }))
                .sort((a, b) => {
                    // Prefer clusters with meaningfully higher count; break near-ties by smaller |angle|
                    if (Math.abs(b.count - a.count) > Math.max(2, maxCount * 0.15)) {
                        return b.count - a.count;
                    }
                    return Math.abs(a.angleDeg) - Math.abs(b.angleDeg);
                });
        }

        /**
         * Resolves the active primary lattice vector from discovered axes or an optional
         * user Target Angle (°) override (with directional fallback if the target axis
         * is longer than the shortest neighbor spacing).
         */
        function resolvePrimaryLatticeVector(centroids, discoveredAxes) {
            const rawTarget = UI.inpTargetAngle ? UI.inpTargetAngle.value.trim() : '';
            const targetAngle = rawTarget !== '' ? parseFloat(rawTarget) : NaN;
            State.targetAngle = isNaN(targetAngle) ? null : targetAngle;

            // Normalize any angle into (-90, 90] for undirected axis comparison
            const normAxisAngle = (deg) => {
                let a = ((deg + 90) % 180 + 180) % 180 - 90;
                if (a <= -90 + 1e-6) a = 90;
                return a;
            };
            const axisAngDiff = (a, b) => {
                const diff = Math.abs(normAxisAngle(a) - normAxisAngle(b));
                return Math.min(diff, 180 - diff);
            };

            // 1. Target Angle override takes highest priority
            if (!isNaN(targetAngle)) {
                const normTarget = normAxisAngle(targetAngle);
                // First check discovered nearest-neighbor axes within ±15°
                let bestAxis = null;
                let minDiff = Infinity;
                for (const ax of discoveredAxes) {
                    const diff = axisAngDiff(ax.angleDeg, normTarget);
                    if (diff <= 15 && diff < minDiff) {
                        minDiff = diff;
                        bestAxis = ax;
                    }
                }
                if (bestAxis) return { dx: bestAxis.dx, dy: bestAxis.dy };

                // Fallback: directional scan along targetAngle (for secondary/longer axes)
                const rad = normTarget * (Math.PI / 180);
                const ux = Math.cos(rad);
                const uy = Math.sin(rad);
                const dirSamples = [];
                for (let i = 0; i < centroids.length; i++) {
                    let bestDist = Infinity;
                    let bestVec = null;
                    for (let j = 0; j < centroids.length; j++) {
                        if (i === j) continue;
                        const dx = centroids[j].x - centroids[i].x;
                        const dy = centroids[j].y - centroids[i].y;
                        const proj = dx * ux + dy * uy;
                        const perp = Math.abs(dx * uy - dy * ux);
                        if (proj <= 1e-6) continue;
                        const angDev = Math.atan2(perp, proj) * (180 / Math.PI);
                        if (angDev <= 15) {
                            const d = Math.hypot(dx, dy);
                            if (d < bestDist) {
                                bestDist = d;
                                bestVec = { dx, dy };
                            }
                        }
                    }
                    if (bestVec) dirSamples.push(bestVec);
                }
                if (dirSamples.length > 0) {
                    // Use median dx/dy of directional hits
                    const dxs = dirSamples.map(v => v.dx).sort((a, b) => a - b);
                    const dys = dirSamples.map(v => v.dy).sort((a, b) => a - b);
                    return {
                        dx: dxs[Math.floor(dxs.length / 2)],
                        dy: dys[Math.floor(dys.length / 2)]
                    };
                }
            }

            // 2. Explicit dropdown axis selection
            if (State.selectedAxisIndex !== 'auto') {
                const idx = parseInt(State.selectedAxisIndex, 10);
                if (!isNaN(idx) && discoveredAxes[idx]) {
                    return { dx: discoveredAxes[idx].dx, dy: discoveredAxes[idx].dy };
                }
            }

            // 3. Auto: highest-priority discovered axis
            if (discoveredAxes.length > 0) {
                return { dx: discoveredAxes[0].dx, dy: discoveredAxes[0].dy };
            }
            return { dx: 1, dy: 0 };
        }

        function populateLatticeAxisSelector() {
            if (!UI.selLatticeAxis) return;
            const prevVal = String(State.selectedAxisIndex);
            UI.selLatticeAxis.innerHTML = '';

            const autoLabel = State.discoveredAxes.length > 0
                ? `Auto (${State.discoveredAxes[0].angleDeg.toFixed(1)}°)`
                : 'Auto (Primary)';
            UI.selLatticeAxis.add(new Option(autoLabel, 'auto'));

            State.discoveredAxes.forEach((ax, idx) => {
                const label = `Axis ${idx + 1}: ${ax.angleDeg.toFixed(1)}° (d=${ax.dist.toFixed(2)}, n=${ax.count})`;
                UI.selLatticeAxis.add(new Option(label, String(idx)));
            });

            if (Array.from(UI.selLatticeAxis.options).some(o => o.value === prevVal)) {
                UI.selLatticeAxis.value = prevVal;
            } else {
                State.selectedAxisIndex = 'auto';
                UI.selLatticeAxis.value = 'auto';
            }
        }

        function computeLatticeSteppingAndRender() {
            if (State.centroids.length === 0) return;

            const primaryVec = resolvePrimaryLatticeVector(State.centroids, State.discoveredAxes);
            State.latticeVector = primaryVec;
            State.refStep = { dx: Math.abs(primaryVec.dx), dy: Math.abs(primaryVec.dy) };

            const pitchMag = Math.hypot(primaryVec.dx, primaryVec.dy) || 1;
            const maxMatchError = pitchMag * 0.45;

            State.xSteps = [];
            State.ySteps = [];
            State.angles = [];
            State.targetNeighbors = [];

            for (let i = 0; i < State.centroids.length; i++) {
                let bestNeighbor = null;
                let minDiff = Infinity;

                for (let j = 0; j < State.centroids.length; j++) {
                    if (i === j) continue;
                    const dx = State.centroids[j].x - State.centroids[i].x;
                    const dy = State.centroids[j].y - State.centroids[i].y;
                    const diff = Math.hypot(dx - primaryVec.dx, dy - primaryVec.dy);
                    if (diff < minDiff && diff <= maxMatchError) {
                        minDiff = diff;
                        bestNeighbor = { dx: Math.abs(dx), dy: Math.abs(dy), index: j };
                    }
                }

                if (bestNeighbor) {
                    State.xSteps.push(bestNeighbor.dx);
                    State.ySteps.push(bestNeighbor.dy);
                    State.angles.push(Math.atan2(bestNeighbor.dy, bestNeighbor.dx) * (180 / Math.PI));
                    State.targetNeighbors.push(bestNeighbor.index);
                } else {
                    State.xSteps.push(null);
                    State.ySteps.push(null);
                    State.angles.push(null);
                    State.targetNeighbors.push(null);
                }
            }

            // Recompute custom dimensions so lattice-based neighbor charts stay synced
            for (const chartDivId in State.customDims) {
                const dim = State.customDims[chartDivId];
                const result = computeCustomDimData(dim.config);
                if (result) {
                    dim.values = result.dimensions;
                    dim.labels = result.chartLabels;
                }
            }

            if (State.autoSigmaOnNextProcess) {
                State.autoSigmaOnNextProcess = false;
                autoRunConfiguredSigmaTolerances();
            }

            renderStepPlots({ skipOverview: true });
            renderBBPlots({ skipOverview: true });
            for (const chartDivId in State.customDims) {
                const idx = parseInt(chartDivId.split('_')[1], 10);
                renderCustomDimChart(idx, { skipOverview: true });
            }
            update3DOverview();
        }

        function onLatticeAxisChange() {
            State.selectedAxisIndex = UI.selLatticeAxis.value;
            if (UI.inpTargetAngle && UI.inpTargetAngle.value.trim() !== '') {
                UI.inpTargetAngle.value = '';
                State.targetAngle = null;
            }
            if (State.centroids.length > 0) {
                computeLatticeSteppingAndRender();
            }
        }
        window.onLatticeAxisChange = onLatticeAxisChange;

        const onTargetAngleChange = debounce(() => {
            if (State.centroids.length > 0) {
                computeLatticeSteppingAndRender();
            }
        }, 200);
        window.onTargetAngleChange = onTargetAngleChange;

        function processData() {
            if (!State.rawPoints || State.rawPoints.length === 0) {
                showNotification("Please load a data file or sample data first.", 'error');
                return;
            }

            const distances = [];
            for (let i = 0; i < State.rawPoints.length - 1; i++) {
                const p1 = State.rawPoints[i];
                const p2 = State.rawPoints[i + 1];
                distances.push(Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z));
            }

            let threshold = parseFloat(UI.inpThreshold.value);
            if (isNaN(threshold) || threshold <= 0) {
                threshold = detectAutoSplitThreshold(distances);
                UI.inpThreshold.placeholder = `Auto (${threshold.toFixed(3)})`;
            }

            // Segment raw points into apertures and build bidirectional index maps
            State.apertures = [];
            State.pointToApertureMap = new Array(State.rawPoints.length);
            State.aperturePointRanges = [];

            let currentAp = [State.rawPoints[0]];
            let apStart = 0;
            State.pointToApertureMap[0] = 0;

            for (let i = 0; i < distances.length; i++) {
                if (distances[i] > threshold) {
                    State.apertures.push(currentAp);
                    State.aperturePointRanges.push({ start: apStart, end: i });
                    currentAp = [];
                    apStart = i + 1;
                }
                const apIdx = State.apertures.length;
                State.pointToApertureMap[i + 1] = apIdx;
                currentAp.push(State.rawPoints[i + 1]);
            }
            if (currentAp.length > 0) {
                State.apertures.push(currentAp);
                State.aperturePointRanges.push({ start: apStart, end: State.rawPoints.length - 1 });
            }
            if (State.apertures.length === 0) return;

            // Compute centroids & bounding boxes
            State.centroids = [];
            State.bbWidths = [];
            State.bbHeights = [];

            State.apertures.forEach(aperture => {
                let sumX = 0, sumY = 0, sumZ = 0;
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const pt of aperture) {
                    sumX += pt.x; sumY += pt.y; sumZ += pt.z;
                    if (pt.x < minX) minX = pt.x;
                    if (pt.x > maxX) maxX = pt.x;
                    if (pt.y < minY) minY = pt.y;
                    if (pt.y > maxY) maxY = pt.y;
                }
                State.centroids.push({
                    x: sumX / aperture.length,
                    y: sumY / aperture.length,
                    z: sumZ / aperture.length
                });
                State.bbWidths.push(maxX - minX);
                State.bbHeights.push(maxY - minY);
            });

            // Multi-axis lattice discovery
            State.discoveredAxes = discoverLatticeAxes(State.centroids);
            populateLatticeAxisSelector();

            updateUIAfterProcessing();
            computeLatticeSteppingAndRender();
        }

        function updateUIAfterProcessing() {
            UI.welcomeScreen.classList.add('hidden');
            UI.summaryPanel.classList.remove('hidden');
            UI.exportPanel.classList.remove('hidden');
            UI.cardDimensions.classList.remove('hidden');

            updateLayoutMode();

            UI.statTotalPoints.textContent = String(State.rawPoints.length);
            UI.statApertures.textContent = String(State.apertures.length);

            let maxPts = 0;
            State.apertures.forEach(ap => { if (ap.length > maxPts) maxPts = ap.length; });

            UI.selPointA.innerHTML = '';
            UI.selPointB.innerHTML = '';
            UI.selPointA.add(new Option('Centroid', 'centroid'));
            UI.selPointB.add(new Option('Centroid', 'centroid'));
            for (let i = 0; i < maxPts; i++) {
                UI.selPointA.add(new Option(`Pt ${i}`, String(i)));
                UI.selPointB.add(new Option(`Pt ${i}`, String(i)));
            }
            if (maxPts > 1) UI.selPointB.selectedIndex = 2;

            UI.selDimMode.value = 'internal';
            toggleDimMode();

            if (Object.keys(State.customDims).length === 0) {
                UI.emptyDimensionMsg.classList.remove('hidden');
            } else {
                UI.emptyDimensionMsg.classList.add('hidden');
            }
        }

        /* =========================================================================
         * Filtering, Tolerance Bands, Axis Scales & Statistics
         * ========================================================================= */
        function getFilteredData(dataArr, minId, maxId) {
            const minStr = document.getElementById(minId)?.value;
            const maxStr = document.getElementById(maxId)?.value;
            const min = (minStr !== undefined && minStr !== '') ? parseFloat(minStr) : -Infinity;
            const max = (maxStr !== undefined && maxStr !== '') ? parseFloat(maxStr) : Infinity;
            return dataArr.map(v => (v !== null && v !== undefined && v >= min && v <= max) ? v : null);
        }

        function getManualYAxisConfig(minId, maxId) {
            const minEl = document.getElementById(minId);
            const maxEl = document.getElementById(maxId);
            const min = minEl ? parseFloat(minEl.value) : NaN;
            const max = maxEl ? parseFloat(maxEl.value) : NaN;
            if (!isNaN(min) && !isNaN(max) && max > min) {
                return { range: [min, max], autorange: false };
            }
            return { autorange: true };
        }

        function applyScale(plotId, minId, maxId) {
            const cfg = getManualYAxisConfig(minId, maxId);
            const update = cfg.autorange
                ? { 'yaxis.autorange': true }
                : { 'yaxis.range': cfg.range, 'yaxis.autorange': false };
            Plotly.relayout(plotId, update);
        }
        window.applyScale = applyScale;

        function getToleranceShapes(nomVal, tol1Val, tol2Val, tol3Val) {
            const shapes = [];
            if (!isNaN(nomVal)) {
                const t1 = (!isNaN(tol1Val) && tol1Val > 0) ? tol1Val : null;
                const t2 = (!isNaN(tol2Val) && tol2Val > 0) ? tol2Val : null;
                const t3 = (!isNaN(tol3Val) && tol3Val > 0) ? tol3Val : null;

                const validTols = [
                    { val: t3, color: '#ef4444', op: 0.10 },
                    { val: t2, color: '#f59e0b', op: 0.15 },
                    { val: t1, color: '#22c55e', op: 0.15 }
                ].filter(t => t.val !== null).sort((a, b) => b.val - a.val);

                validTols.forEach(t => {
                    shapes.push({
                        type: 'rect',
                        y0: nomVal - t.val,
                        y1: nomVal + t.val,
                        x0: 0,
                        x1: 1,
                        xref: 'paper',
                        yref: 'y',
                        fillcolor: t.color,
                        opacity: t.op,
                        line: { width: 0 },
                        layer: 'below'
                    });
                });

                shapes.push({
                    type: 'line',
                    y0: nomVal,
                    y1: nomVal,
                    x0: 0,
                    x1: 1,
                    xref: 'paper',
                    yref: 'y',
                    line: { color: '#22c55e', width: 2, dash: 'dot' }
                });
            }
            return shapes;
        }

        function calcAvg(dataArr) {
            const valid = dataArr.filter(d => d !== null && d !== undefined);
            return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
        }

        function getAvgTrace(xLabels, avgVal) {
            const xStart = xLabels.length > 0 ? xLabels[0] : 0;
            const xEnd = xLabels.length > 0 ? xLabels[xLabels.length - 1] : 1;
            return {
                x: [xStart, xEnd],
                y: [avgVal, avgVal],
                type: 'scatter',
                mode: 'lines',
                line: { color: '#94a3b8', dash: 'dash', width: 2 },
                name: 'Average',
                hoverinfo: 'skip'
            };
        }

        /**
         * Explicitly triggered by the blue "σ" button (or automatically on file/config load)
         * to compute empirical 1σ (T2) and 3σ (T3) bounds without clobbering manual input mid-typing.
         */
        function autoFillSigmaTolerances(metricId, opts = {}) {
            let data = [];
            if (metricId === 'stepX') data = getFilteredData(State.xSteps, 'fMinStepX', 'fMaxStepX');
            else if (metricId === 'stepY') data = getFilteredData(State.ySteps, 'fMinStepY', 'fMaxStepY');
            else if (metricId === 'angle') data = getFilteredData(State.angles, 'fMinAngle', 'fMaxAngle');
            else if (metricId === 'bbX') data = getFilteredData(State.bbWidths, 'fMinBBX', 'fMaxBBX');
            else if (metricId === 'bbY') data = getFilteredData(State.bbHeights, 'fMinBBY', 'fMaxBBY');
            else if (metricId.startsWith('dimChart_')) {
                const chartData = State.customDims[metricId];
                if (chartData) {
                    const idx = metricId.split('_')[1];
                    data = getFilteredData(chartData.values, `fMinDim_${idx}`, `fMaxDim_${idx}`);
                }
            }

            const validVals = data.filter(d => d !== null && d !== undefined);
            if (validVals.length === 0) {
                if (!opts.silent) {
                    showNotification("No valid data points available to compute sigma tolerances.", "warning");
                }
                return;
            }

            let suffix = metricId;
            if (metricId === 'bbX') suffix = 'BBX';
            else if (metricId === 'bbY') suffix = 'BBY';
            else suffix = metricId.charAt(0).toUpperCase() + metricId.slice(1);

            const isCustom = metricId.startsWith('dimChart_');
            const cIdx = isCustom ? metricId.split('_')[1] : '';

            const nomInput = document.getElementById(isCustom ? `nomDim_${cIdx}` : `inpNom${suffix}`);
            const t1Input = document.getElementById(isCustom ? `tol1Dim_${cIdx}` : `inpTol1${suffix}`);
            const t2Input = document.getElementById(isCustom ? `tol2Dim_${cIdx}` : `inpTol2${suffix}`);
            const t3Input = document.getElementById(isCustom ? `tol3Dim_${cIdx}` : `inpTol3${suffix}`);

            let nom = nomInput ? parseFloat(nomInput.value) : NaN;
            if (isNaN(nom)) {
                nom = calcAvg(validVals);
                if (nomInput) nomInput.value = parseFloat(nom.toFixed(4));
            }

            const deviations = validVals.map(v => Math.abs(v - nom)).sort((a, b) => a - b);

            function findBestTolerance(devs, targetRate) {
                const total = devs.length;
                if (total === 0) return 0;
                let bestTol = 0;
                let minDiff = Math.abs(1.0 - targetRate);
                for (let i = 0; i < total; i++) {
                    if (i < total - 1 && devs[i] === devs[i + 1]) continue;
                    const fails = total - 1 - i;
                    const diff = Math.abs((fails / total) - targetRate);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestTol = devs[i];
                    }
                }
                return bestTol;
            }

            const t2Val = findBestTolerance(deviations, 0.3173);
            const t3Val = findBestTolerance(deviations, 0.0027);
            const t1Val = t1Input ? parseFloat(t1Input.value) : NaN;

            let finalT2 = '';
            let finalT3 = '';

            if (!isNaN(t1Val) && t1Val > 0) {
                if (t1Val >= t3Val) {
                    finalT2 = '';
                    finalT3 = '';
                } else if (t1Val >= t2Val) {
                    finalT2 = parseFloat(t3Val.toFixed(4));
                    finalT3 = '';
                } else {
                    finalT2 = parseFloat(t2Val.toFixed(4));
                    finalT3 = parseFloat(t3Val.toFixed(4));
                }
            } else {
                finalT2 = parseFloat(t2Val.toFixed(4));
                finalT3 = parseFloat(t3Val.toFixed(4));
            }

            if (t2Input) t2Input.value = finalT2;
            if (t3Input) t3Input.value = finalT3;

            if (!opts.skipRender) {
                if (isCustom) renderCustomDimChart(parseInt(cIdx, 10));
                else if (metricId === 'bbX' || metricId === 'bbY') renderBBPlots();
                else renderStepPlots();
            }
        }
        window.autoFillSigmaTolerances = autoFillSigmaTolerances;

        /**
         * Automatically recalculates T2 (1σ) & T3 (3σ) on file or config load for all charts
         * that have any tolerance parameter (Nom, T1, T2, or T3) configured.
         */
        function autoRunConfiguredSigmaTolerances() {
            const hasAnyTolValue = (ids) => ids.some(id => {
                const el = document.getElementById(id);
                return el && el.value.trim() !== '';
            });

            const defaults = [
                { metricId: 'stepX', suffix: 'StepX' },
                { metricId: 'stepY', suffix: 'StepY' },
                { metricId: 'angle', suffix: 'Angle' },
                { metricId: 'bbX', suffix: 'BBX' },
                { metricId: 'bbY', suffix: 'BBY' }
            ];

            defaults.forEach(({ metricId, suffix }) => {
                if (hasAnyTolValue([`inpNom${suffix}`, `inpTol1${suffix}`, `inpTol2${suffix}`, `inpTol3${suffix}`])) {
                    autoFillSigmaTolerances(metricId, { skipRender: true, silent: true });
                }
            });

            for (const chartDivId in State.customDims) {
                const idx = chartDivId.split('_')[1];
                if (hasAnyTolValue([`nomDim_${idx}`, `tol1Dim_${idx}`, `tol2Dim_${idx}`, `tol3Dim_${idx}`])) {
                    autoFillSigmaTolerances(chartDivId, { skipRender: true, silent: true });
                }
            }
        }

        function updateMetricStats(data, nomId, tol1Id, tol2Id, tol3Id, metricId, metricName, unit, isRawPoints = false) {
            State.metricFails[metricId] = { notice: new Set(), warn: new Set(), critical: new Set() };
            const nom = parseFloat(document.getElementById(nomId)?.value);
            const rawT1 = parseFloat(document.getElementById(tol1Id)?.value);
            const rawT2 = parseFloat(document.getElementById(tol2Id)?.value);
            const rawT3 = parseFloat(document.getElementById(tol3Id)?.value);

            // Guard against zero or negative tolerances
            const t1 = (!isNaN(rawT1) && rawT1 > 0) ? rawT1 : null;
            const t2 = (!isNaN(rawT2) && rawT2 > 0) ? rawT2 : null;
            const t3 = (!isNaN(rawT3) && rawT3 > 0) ? rawT3 : null;

            const hasTol = !isNaN(nom) && (t1 !== null || t2 !== null || t3 !== null);

            let fails1 = 0, fails2 = 0, fails3 = 0;
            const totalValid = data.filter(d => d !== null && d !== undefined).length;

            if (hasTol) {
                if (!State.knownMetrics.has(metricId)) {
                    State.activeFailFilters.add(metricId);
                    State.knownMetrics.add(metricId);
                }

                data.forEach((val, i) => {
                    if (val !== null && val !== undefined) {
                        const dev = Math.abs(val - nom);
                        if (t1 !== null && dev > t1) fails1++;
                        if (t2 !== null && dev > t2) fails2++;
                        if (t3 !== null && dev > t3) fails3++;

                        // Map raw point indices back to their parent aperture for 3D highlighting
                        const apIdx = isRawPoints ? State.pointToApertureMap[i] : i;
                        if (apIdx === undefined) return;

                        if (t3 !== null && dev > t3) {
                            State.metricFails[metricId].critical.add(apIdx);
                        } else if (t2 !== null && dev > t2) {
                            State.metricFails[metricId].warn.add(apIdx);
                        } else if (t1 !== null && dev > t1) {
                            State.metricFails[metricId].notice.add(apIdx);
                        }
                    }
                });
            } else {
                State.activeFailFilters.delete(metricId);
                State.knownMetrics.delete(metricId);
            }

            const avg = calcAvg(data);
            State.metricsData[metricId] = {
                id: metricId,
                name: metricName,
                avg,
                nom,
                t1,
                t2,
                t3,
                hasTol,
                fails1,
                fails2,
                fails3,
                totalValid,
                unit
            };

            const statsEl = document.getElementById(`stats_${metricId}`);
            if (statsEl) {
                let txt = `Avg: ${avg.toFixed(3)}${unit}`;
                if (hasTol) {
                    if (t1 !== null) {
                        const pct1 = totalValid > 0 ? ((fails1 / totalValid) * 100).toFixed(2) : "0.00";
                        txt += ` | T1 Fails: ${fails1}/${totalValid} (${pct1}%)`;
                    }
                    if (t2 !== null) {
                        const pct2 = totalValid > 0 ? ((fails2 / totalValid) * 100).toFixed(2) : "0.00";
                        txt += ` | T2 Fails: ${fails2}/${totalValid} (${pct2}%)`;
                    }
                    if (t3 !== null) {
                        const pct3 = totalValid > 0 ? ((fails3 / totalValid) * 100).toFixed(2) : "0.00";
                        txt += ` | T3 Fails: ${fails3}/${totalValid} (${pct3}%)`;
                    }
                }
                statsEl.textContent = txt;

                if (hasTol && (fails1 > 0 || fails2 > 0 || fails3 > 0)) {
                    const hasCritical = (fails3 > 0 && t3 !== null) || (fails2 > 0 && t3 === null) || (fails1 > 0 && t2 === null);
                    statsEl.className = `text-[11px] font-medium mt-1.5 inline-block px-2 py-0.5 rounded border transition-colors ${hasCritical ? 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800' : 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800'}`;
                } else {
                    statsEl.className = 'text-[11px] font-medium text-slate-600 dark:text-slate-300 mt-1.5 bg-slate-100/80 dark:bg-slate-800/80 inline-block px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 transition-colors';
                }
            }
        }

        /* =========================================================================
         * 3D / 2D Overview Rendering & Fail Filter Dropdown
         * ========================================================================= */
        function set3DView(view) {
            State.overviewView = view;
            renderOverviewPlot();
        }
        window.set3DView = set3DView;

        function toggleFailFilter(metricId, isChecked) {
            if (isChecked) State.activeFailFilters.add(metricId);
            else State.activeFailFilters.delete(metricId);
            update3DOverview();
        }
        window.toggleFailFilter = toggleFailFilter;

        function update3DOverview() {
            if (!State.rawPoints || State.rawPoints.length === 0) return;

            const activeMetrics = Object.values(State.metricsData).filter(m => m.hasTol);
            const container = document.getElementById('failFilterContainer');
            const dropdown = document.getElementById('dropdownFailFilter');

            if (activeMetrics.length === 0 || !UI.chkHighlightTol.checked) {
                container.classList.add('hidden');
                container.classList.remove('flex');
                dropdown.classList.add('hidden');
            } else {
                container.classList.remove('hidden');
                container.classList.add('flex');
                dropdown.textContent = '';

                const header = document.createElement('div');
                header.className = 'text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-1';
                header.textContent = 'Include Fails From:';
                dropdown.appendChild(header);

                activeMetrics.forEach(m => {
                    const label = document.createElement('label');
                    label.className = 'flex items-center gap-2 text-xs cursor-pointer mb-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 p-1 rounded transition-colors dark:text-slate-200';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'rounded text-blue-600 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600';
                    cb.value = m.id;
                    cb.checked = State.activeFailFilters.has(m.id);
                    cb.addEventListener('change', () => toggleFailFilter(m.id, cb.checked));

                    const span = document.createElement('span');
                    span.className = 'truncate';
                    span.title = m.name;
                    span.textContent = m.name;

                    label.appendChild(cb);
                    label.appendChild(span);
                    dropdown.appendChild(label);
                });
            }

            State.outOfTolApertures = { notice: new Set(), warn: new Set(), critical: new Set() };
            for (const mId in State.metricFails) {
                if (!State.activeFailFilters.has(mId)) continue;
                State.metricFails[mId].notice?.forEach(apIdx => State.outOfTolApertures.notice.add(apIdx));
                State.metricFails[mId].warn?.forEach(apIdx => State.outOfTolApertures.warn.add(apIdx));
                State.metricFails[mId].critical?.forEach(apIdx => State.outOfTolApertures.critical.add(apIdx));
            }

            renderOverviewPlot();
        }
        window.update3DOverview = update3DOverview;

        function renderOverviewPlot() {
            const plotX = [], plotY = [], plotZ = [], plotText = [], plotColors = [], plotTextArr = [];
            const baseColor = UI.inpMarkerColor.value || '#3b82f6';
            const criticalColor = '#ef4444';
            const warnColor = '#f97316';
            const noticeColor = '#eab308';
            const centroidColor = UI.inpCentroidColor.value || '#94a3b8';
            const highlightFailures = UI.chkHighlightTol.checked;
            const showLabels = UI.chkShowLabels.checked;
            const markerSize = parseInt(UI.inpMarkerSize.value, 10) || 2;
            const centroidSize = parseInt(UI.inpCentroidSize.value, 10) || 3;
            const view = State.overviewView || 'xy';
            const is2D = view !== 'iso';
            const theme = getThemeLayout();
            const unitBracket = getUnitBracket();

            const legBase = document.getElementById('legBase');
            const legCentroid = document.getElementById('legCentroid');
            const overviewLegend = document.getElementById('overviewLegend');
            const failLegends = document.querySelectorAll('.leg-fail');

            if (legBase) legBase.style.backgroundColor = baseColor;
            if (legCentroid) legCentroid.style.backgroundColor = centroidColor;
            if (overviewLegend) overviewLegend.classList.remove('hidden');
            failLegends.forEach(el => {
                if (highlightFailures) el.classList.remove('hidden');
                else el.classList.add('hidden');
            });

            State.apertures.forEach((ap, apIdx) => {
                let color = baseColor;
                if (highlightFailures) {
                    if (State.outOfTolApertures.critical.has(apIdx)) color = criticalColor;
                    else if (State.outOfTolApertures.warn.has(apIdx)) color = warnColor;
                    else if (State.outOfTolApertures.notice.has(apIdx)) color = noticeColor;
                }
                ap.forEach((pt, ptIdx) => {
                    plotX.push(pt.x);
                    plotY.push(pt.y);
                    plotZ.push(pt.z);
                    plotText.push(`Aperture: ${apIdx}<br>Point: ${ptIdx}`);
                    plotColors.push(color);
                    plotTextArr.push((showLabels && ptIdx === 0) ? `${apIdx}` : '');
                });
            });

            let tracePoints = {};
            let traceCentroids = {};
            const layout = {
                legend: { x: 0, y: 1, font: { color: theme.fontColor } },
                paper_bgcolor: theme.paper_bgcolor,
                plot_bgcolor: theme.plot_bgcolor,
                font: { color: theme.fontColor }
            };

            if (is2D) {
                let px = [], py = [], cx = [], cy = [], xTitle = 'X', yTitle = 'Y';
                if (view === 'xy') {
                    px = plotX; py = plotY;
                    cx = State.centroids.map(p => p.x); cy = State.centroids.map(p => p.y);
                    xTitle = 'X'; yTitle = 'Y';
                } else if (view === 'xz') {
                    px = plotX; py = plotZ;
                    cx = State.centroids.map(p => p.x); cy = State.centroids.map(p => p.z);
                    xTitle = 'X'; yTitle = 'Z';
                } else if (view === 'yz') {
                    px = plotY; py = plotZ;
                    cx = State.centroids.map(p => p.y); cy = State.centroids.map(p => p.z);
                    xTitle = 'Y'; yTitle = 'Z';
                }

                tracePoints = {
                    x: px, y: py, text: plotTextArr, hovertext: plotText,
                    textposition: 'top center', mode: showLabels ? 'markers+text' : 'markers',
                    textfont: { size: 12, color: theme.fontColor },
                    hovertemplate: `<b>%{hovertext}</b><br>${xTitle}: %{x:.4f}<br>${yTitle}: %{y:.4f}<extra></extra>`,
                    marker: { size: markerSize * 2, color: plotColors, opacity: 0.85 },
                    type: 'scattergl', name: 'Measurement Points'
                };

                traceCentroids = {
                    x: cx, y: cy,
                    text: State.centroids.map((_, i) => `Aperture: ${i}<br>Centroid`),
                    hovertemplate: `<b>%{text}</b><br>${xTitle}: %{x:.4f}<br>${yTitle}: %{y:.4f}<extra></extra>`,
                    mode: 'markers', marker: { size: centroidSize * 2, color: centroidColor, symbol: 'diamond' },
                    type: 'scattergl', name: 'Aperture Centroids'
                };

                layout.margin = { l: 48, r: 20, b: 44, t: 20 };
                layout.xaxis = { title: `${xTitle} ${unitBracket}`.trim(), gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor };
                layout.yaxis = { title: `${yTitle} ${unitBracket}`.trim(), gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor };

                if (State.isEqualAxes) {
                    layout.yaxis.scaleanchor = 'x';
                    layout.yaxis.scaleratio = 1;
                }
            } else {
                tracePoints = {
                    x: plotX, y: plotY, z: plotZ, text: plotTextArr, hovertext: plotText,
                    textposition: 'top center', mode: showLabels ? 'markers+text' : 'markers',
                    textfont: { size: 12, color: theme.fontColor },
                    hovertemplate: '<b>%{hovertext}</b><br>X: %{x:.4f}<br>Y: %{y:.4f}<br>Z: %{z:.4f}<extra></extra>',
                    marker: { size: markerSize, color: plotColors, opacity: 0.85 },
                    type: 'scatter3d', name: 'Measurement Points'
                };

                traceCentroids = {
                    x: State.centroids.map(p => p.x), y: State.centroids.map(p => p.y), z: State.centroids.map(p => p.z),
                    text: State.centroids.map((_, i) => `Aperture: ${i}<br>Centroid`),
                    hovertemplate: '<b>%{text}</b><br>X: %{x:.4f}<br>Y: %{y:.4f}<br>Z: %{z:.4f}<extra></extra>',
                    mode: 'markers', marker: { size: centroidSize, color: centroidColor, symbol: 'diamond' },
                    type: 'scatter3d', name: 'Aperture Centroids'
                };

                layout.margin = { l: 0, r: 0, b: 0, t: 0 };
                layout.scene = {
                    xaxis: { title: `X ${unitBracket}`.trim(), gridcolor: theme.gridColor, backgroundcolor: theme.plot_bgcolor },
                    yaxis: { title: `Y ${unitBracket}`.trim(), gridcolor: theme.gridColor, backgroundcolor: theme.plot_bgcolor },
                    zaxis: { title: `Z ${unitBracket}`.trim(), gridcolor: theme.gridColor, backgroundcolor: theme.plot_bgcolor },
                    aspectmode: State.isEqualAxes ? 'data' : 'auto',
                    camera: { eye: { x: 1.2, y: 1.2, z: 1.2 } }
                };
            }

            Plotly.react('plotOverview', [tracePoints, traceCentroids], layout, { responsive: true });
            bindOverviewZoomSync();
        }

        /* =========================================================================
         * 2D Metric Chart Renderers (Preserving Manual Axis Scales)
         * ========================================================================= */
        function renderStepPlots(opts = {}) {
            const xLabels = State.targetNeighbors.map((val, i) => val !== null ? `${i}→${val}` : `${i}`);
            const xData = getFilteredData(State.xSteps, 'fMinStepX', 'fMaxStepX');
            const yData = getFilteredData(State.ySteps, 'fMinStepY', 'fMaxStepY');
            const angleData = getFilteredData(State.angles, 'fMinAngle', 'fMaxAngle');

            const unitSuffix = getUnitSuffix();
            const unitBracket = getUnitBracket() || 'Value';

            updateMetricStats(xData, 'inpNomStepX', 'inpTol1StepX', 'inpTol2StepX', 'inpTol3StepX', 'stepX', 'X-Lattice', unitSuffix);
            updateMetricStats(yData, 'inpNomStepY', 'inpTol1StepY', 'inpTol2StepY', 'inpTol3StepY', 'stepY', 'Y-Lattice', unitSuffix);
            updateMetricStats(angleData, 'inpNomAngle', 'inpTol1Angle', 'inpTol2Angle', 'inpTol3Angle', 'angle', 'Lattice Angle', '°');

            const avgX = State.metricsData['stepX'].avg;
            const avgY = State.metricsData['stepY'].avg;
            const avgAngle = State.metricsData['angle'].avg;
            const theme = getThemeLayout();
            const hoverTxt = State.targetNeighbors.map((val, i) => val !== null ? `Ap ${i} → Ap ${val}` : `Ap ${i}`);
            const mSize = get2DMarkerSize();

            const layoutBase = {
                margin: { l: 75, r: 20, b: 70, t: 20 },
                xaxis: { title: 'Aperture Index Map', tickangle: 45, type: 'category', gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor },
                paper_bgcolor: theme.paper_bgcolor,
                plot_bgcolor: theme.plot_bgcolor,
                font: { color: theme.fontColor },
                showlegend: false
            };

            Plotly.react('plotStepX', [
                {
                    x: xLabels, y: xData, text: hoverTxt, type: 'scatter', mode: 'lines+markers',
                    hovertemplate: `<b>%{text}</b><br>X-Lattice: <b>%{y:.3f}${unitSuffix}</b><extra></extra>`,
                    line: { color: '#8b5cf6' }, marker: { size: mSize }, connectgaps: false, name: 'X-Lattice'
                },
                getAvgTrace(xLabels, avgX)
            ], {
                ...layoutBase,
                yaxis: {
                    title: { text: unitBracket, standoff: 15 },
                    automargin: true, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, tickformat: '.3f',
                    ...getManualYAxisConfig('minStepX', 'maxStepX')
                },
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById('inpNomStepX').value),
                    parseFloat(document.getElementById('inpTol1StepX').value),
                    parseFloat(document.getElementById('inpTol2StepX').value),
                    parseFloat(document.getElementById('inpTol3StepX').value)
                )
            }, { responsive: true });

            Plotly.react('plotStepY', [
                {
                    x: xLabels, y: yData, text: hoverTxt, type: 'scatter', mode: 'lines+markers',
                    hovertemplate: `<b>%{text}</b><br>Y-Lattice: <b>%{y:.3f}${unitSuffix}</b><extra></extra>`,
                    line: { color: '#10b981' }, marker: { size: mSize }, connectgaps: false, name: 'Y-Lattice'
                },
                getAvgTrace(xLabels, avgY)
            ], {
                ...layoutBase,
                yaxis: {
                    title: { text: unitBracket, standoff: 15 },
                    automargin: true, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, tickformat: '.3f',
                    ...getManualYAxisConfig('minStepY', 'maxStepY')
                },
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById('inpNomStepY').value),
                    parseFloat(document.getElementById('inpTol1StepY').value),
                    parseFloat(document.getElementById('inpTol2StepY').value),
                    parseFloat(document.getElementById('inpTol3StepY').value)
                )
            }, { responsive: true });

            Plotly.react('plotAngle', [
                {
                    x: xLabels, y: angleData, text: hoverTxt, type: 'scatter', mode: 'lines+markers',
                    hovertemplate: '<b>%{text}</b><br>Angle: <b>%{y:.3f}°</b><extra></extra>',
                    line: { color: '#f59e0b' }, marker: { size: mSize }, connectgaps: false, name: 'Lattice Angle'
                },
                getAvgTrace(xLabels, avgAngle)
            ], {
                ...layoutBase,
                yaxis: {
                    title: { text: 'Angle [deg]', standoff: 15 },
                    automargin: true, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, tickformat: '.3f',
                    ...getManualYAxisConfig('minAngle', 'maxAngle')
                },
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById('inpNomAngle').value),
                    parseFloat(document.getElementById('inpTol1Angle').value),
                    parseFloat(document.getElementById('inpTol2Angle').value),
                    parseFloat(document.getElementById('inpTol3Angle').value)
                )
            }, { responsive: true });

            bindZoomSync('plotStepX');
            bindZoomSync('plotStepY');
            bindZoomSync('plotAngle');

            if (!opts.skipOverview) update3DOverview();
        }
        const debouncedRenderStepPlots = debounce(() => renderStepPlots(), 120);
        window.debouncedRenderStepPlots = debouncedRenderStepPlots;

        function renderBBPlots(opts = {}) {
            const xLabels = Array.from({ length: State.bbWidths.length }, (_, i) => String(i));
            const wData = getFilteredData(State.bbWidths, 'fMinBBX', 'fMaxBBX');
            const hData = getFilteredData(State.bbHeights, 'fMinBBY', 'fMaxBBY');

            const unitSuffix = getUnitSuffix();
            const unitBracket = getUnitBracket() || 'Value';

            updateMetricStats(wData, 'inpNomBBX', 'inpTol1BBX', 'inpTol2BBX', 'inpTol3BBX', 'bbX', 'Aperture Width', unitSuffix);
            updateMetricStats(hData, 'inpNomBBY', 'inpTol1BBY', 'inpTol2BBY', 'inpTol3BBY', 'bbY', 'Aperture Height', unitSuffix);

            const avgW = State.metricsData['bbX'].avg;
            const avgH = State.metricsData['bbY'].avg;
            const theme = getThemeLayout();
            const mSize = get2DMarkerSize();

            const layoutBase = {
                margin: { l: 75, r: 20, b: 70, t: 20 },
                xaxis: { title: 'Aperture Index', tickangle: 45, type: 'category', gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor },
                paper_bgcolor: theme.paper_bgcolor,
                plot_bgcolor: theme.plot_bgcolor,
                font: { color: theme.fontColor },
                showlegend: false
            };

            Plotly.react('plotBBX', [
                {
                    x: xLabels, y: wData, type: 'scatter', mode: 'lines+markers',
                    hovertemplate: `<b>Aperture %{x}</b><br>Width: <b>%{y:.3f}${unitSuffix}</b><extra></extra>`,
                    line: { color: '#0ea5e9' }, marker: { size: mSize }, connectgaps: false, name: 'Width'
                },
                getAvgTrace(xLabels, avgW)
            ], {
                ...layoutBase,
                yaxis: {
                    title: { text: unitBracket, standoff: 15 },
                    automargin: true, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, tickformat: '.3f',
                    ...getManualYAxisConfig('minBBX', 'maxBBX')
                },
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById('inpNomBBX').value),
                    parseFloat(document.getElementById('inpTol1BBX').value),
                    parseFloat(document.getElementById('inpTol2BBX').value),
                    parseFloat(document.getElementById('inpTol3BBX').value)
                )
            }, { responsive: true });

            Plotly.react('plotBBY', [
                {
                    x: xLabels, y: hData, type: 'scatter', mode: 'lines+markers',
                    hovertemplate: `<b>Aperture %{x}</b><br>Height: <b>%{y:.3f}${unitSuffix}</b><extra></extra>`,
                    line: { color: '#ec4899' }, marker: { size: mSize }, connectgaps: false, name: 'Height'
                },
                getAvgTrace(xLabels, avgH)
            ], {
                ...layoutBase,
                yaxis: {
                    title: { text: unitBracket, standoff: 15 },
                    automargin: true, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, tickformat: '.3f',
                    ...getManualYAxisConfig('minBBY', 'maxBBY')
                },
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById('inpNomBBY').value),
                    parseFloat(document.getElementById('inpTol1BBY').value),
                    parseFloat(document.getElementById('inpTol2BBY').value),
                    parseFloat(document.getElementById('inpTol3BBY').value)
                )
            }, { responsive: true });

            bindZoomSync('plotBBX');
            bindZoomSync('plotBBY');

            if (!opts.skipOverview) update3DOverview();
        }
        const debouncedRenderBBPlots = debounce(() => renderBBPlots(), 120);
        window.debouncedRenderBBPlots = debouncedRenderBBPlots;

        /* =========================================================================
         * Custom Notable Dimensions (Safe DOM Construction, No innerHTML XSS)
         * ========================================================================= */
        function toggleDimMode() {
            const mode = UI.selDimMode.value;
            const ptA = document.getElementById('dimPointA_container');
            const ptB = document.getElementById('dimPointB_container');
            const metric = UI.selMetricType;

            const currentMetricVal = metric.value;
            metric.innerHTML = '';

            if (mode === 'internal') {
                metric.add(new Option('X Distance (ΔX)', 'dx'));
                metric.add(new Option('Y Distance (ΔY)', 'dy'));
                metric.add(new Option('Absolute Distance', 'euclidean'));
                metric.add(new Option('Vector Angle (°)', 'angle'));
                ptA.style.display = 'block';
                ptB.style.display = 'block';
            } else if (mode.startsWith('neighbor_')) {
                metric.add(new Option('X Distance (ΔX)', 'dx'));
                metric.add(new Option('Y Distance (ΔY)', 'dy'));
                metric.add(new Option('Lattice Angle (°)', 'angle'));
                metric.add(new Option('Absolute Distance', 'euclidean'));
                ptA.style.display = 'none';
                ptB.style.display = 'none';
            } else if (mode === 'absolute_pos') {
                ptA.style.display = 'block';
                ptB.style.display = 'none';
                metric.add(new Option('X Coordinate', 'x'));
                metric.add(new Option('Y Coordinate', 'y'));
                metric.add(new Option('Z Coordinate', 'z'));
            } else if (mode === 'raw_points') {
                ptA.style.display = 'none';
                ptB.style.display = 'none';
                metric.add(new Option('X Coordinate', 'x'));
                metric.add(new Option('Y Coordinate', 'y'));
                metric.add(new Option('Z Coordinate', 'z'));
            }

            if (Array.from(metric.options).some(opt => opt.value === currentMetricVal)) {
                metric.value = currentMetricVal;
            }
        }

        function computeCustomDimData(config) {
            const { mode, metric, metricName, valA, valB, ptAName, ptBName } = config;
            let title = "";
            let dimensions = [];
            let chartLabels = [];
            let xAxisTitle = 'Aperture Index Map';

            if (mode === 'internal') {
                title = `Dimension: ${ptAName} to ${ptBName} (${metricName})`;
                dimensions = State.apertures.map((ap, index) => {
                    chartLabels.push(String(index));
                    const p1 = valA === 'centroid' ? State.centroids[index] : ap[parseInt(valA, 10)];
                    const p2 = valB === 'centroid' ? State.centroids[index] : ap[parseInt(valB, 10)];
                    if (!p1 || !p2) return null;
                    if (metric === 'euclidean') return Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
                    if (metric === 'dx') return Math.abs(p2.x - p1.x);
                    if (metric === 'dy') return Math.abs(p2.y - p1.y);
                    if (metric === 'angle') return Math.atan2(Math.abs(p2.y - p1.y), Math.abs(p2.x - p1.x)) * (180 / Math.PI);
                    return null;
                });
            } else if (mode.startsWith('neighbor_')) {
                const parts = mode.split('_');
                const n = parseInt(parts[parts.length - 1], 10);
                const rankName = n === 1 ? '1st' : (n === 2 ? '2nd' : '3rd');

                let dirType = 'lattice';
                if (mode.includes('_x_')) dirType = 'x';
                if (mode.includes('_y_')) dirType = 'y';

                const metricLabel = metric === 'dx' ? 'X Distance' : (metric === 'dy' ? 'Y Distance' : (metric === 'angle' ? 'Lattice Angle' : 'Absolute Distance'));
                const dirLabel = dirType === 'x' ? 'X' : (dirType === 'y' ? 'Y' : 'Lattice');
                title = `${rankName} Neighbor Along ${dirLabel}: ${metricLabel}`;

                const latVx = State.latticeVector?.dx || State.refStep.dx || 1;
                const latVy = State.latticeVector?.dy || State.refStep.dy || 0;
                const latMag = Math.hypot(latVx, latVy) || 1;

                dimensions = State.centroids.map((ci, i) => {
                    const candidates = [];
                    for (let j = 0; j < State.centroids.length; j++) {
                        if (i === j) continue;
                        const cj = State.centroids[j];
                        const dx = cj.x - ci.x;
                        const dy = cj.y - ci.y;
                        const dz = cj.z - ci.z;
                        const dist2D = Math.hypot(dx, dy);
                        if (dist2D < 1e-5) continue;

                        let proj, perp;
                        if (dirType === 'lattice') {
                            proj = (dx * latVx + dy * latVy) / latMag;
                            perp = Math.abs(dx * latVy - dy * latVx) / latMag;
                        } else if (dirType === 'x') {
                            const signX = (latVx >= 0 || Math.abs(latVx) < 1e-9) ? 1 : -1;
                            proj = dx * signX;
                            perp = Math.abs(dy);
                        } else {
                            const signY = (latVy >= 0 || Math.abs(latVy) < 1e-9) ? 1 : -1;
                            proj = dy * signY;
                            perp = Math.abs(dx);
                        }

                        if (proj <= 0) continue;
                        const angleDev = Math.atan2(perp, proj);
                        if (angleDev <= (30 * Math.PI / 180)) {
                            candidates.push({
                                index: j,
                                proj,
                                perp,
                                dist3D: Math.hypot(dx, dy, dz),
                                dx: Math.abs(dx),
                                dy: Math.abs(dy)
                            });
                        }
                    }

                    if (dirType === 'x' || dirType === 'y') {
                        candidates.sort((a, b) => (a.proj + a.perp * 10) - (b.proj + b.perp * 10));
                    } else {
                        candidates.sort((a, b) => a.proj - b.proj);
                    }

                    if (candidates.length >= n) {
                        const target = candidates[n - 1];
                        chartLabels.push(`${i}→${target.index}`);
                        if (metric === 'dx') return target.dx;
                        if (metric === 'dy') return target.dy;
                        if (metric === 'angle') return Math.atan2(target.dy, target.dx) * (180 / Math.PI);
                        if (metric === 'euclidean') return target.dist3D;
                        return null;
                    } else {
                        chartLabels.push(String(i));
                        return null;
                    }
                });
            } else if (mode === 'absolute_pos') {
                title = `Absolute Position: ${ptAName} (${metricName})`;
                dimensions = State.apertures.map((ap, index) => {
                    chartLabels.push(String(index));
                    const pt = valA === 'centroid' ? State.centroids[index] : ap[parseInt(valA, 10)];
                    if (!pt) return null;
                    return pt[metric] ?? null;
                });
            } else if (mode === 'raw_points') {
                title = `All Points: ${metricName}`;
                xAxisTitle = 'Point Index';
                dimensions = State.rawPoints.map((pt, index) => {
                    chartLabels.push(String(index));
                    return pt[metric] ?? null;
                });
            }

            return { title, dimensions, chartLabels, xAxisTitle };
        }

        function renderCustomDimChart(idx, opts = {}) {
            const chartDivId = `dimChart_${idx}`;
            const chartData = State.customDims[chartDivId];
            if (!chartData) return;

            const dimensionsRaw = chartData.values;
            const xLabels = chartData.labels;
            const xAxisTitle = chartData.xAxisTitle || 'Aperture Index Map';
            const metric = chartData.metric;
            const isAngle = metric === 'angle';
            const unitSuffix = isAngle ? '°' : getUnitSuffix();
            const unitBracket = isAngle ? '[deg]' : (getUnitBracket() || '');

            let yAxisTitle = `Dimension Value ${unitBracket}`.trim();
            let lineColor = '#6366f1';
            if (isAngle) {
                yAxisTitle = 'Lattice Angle [deg]';
                lineColor = '#f59e0b';
            } else if (metric === 'dx') {
                yAxisTitle = `Delta X ${unitBracket}`.trim();
                lineColor = '#8b5cf6';
            } else if (metric === 'dy') {
                yAxisTitle = `Delta Y ${unitBracket}`.trim();
                lineColor = '#10b981';
            } else if (metric === 'euclidean') {
                yAxisTitle = `Distance ${unitBracket}`.trim();
                lineColor = '#0ea5e9';
            } else if (metric === 'x' || metric === 'y' || metric === 'z') {
                yAxisTitle = `${metric.toUpperCase()} Coordinate ${unitBracket}`.trim();
            }

            const filteredDims = getFilteredData(dimensionsRaw, `fMinDim_${idx}`, `fMaxDim_${idx}`);
            const isRaw = chartData.config?.mode === 'raw_points';

            updateMetricStats(
                filteredDims,
                `nomDim_${idx}`, `tol1Dim_${idx}`, `tol2Dim_${idx}`, `tol3Dim_${idx}`,
                chartDivId, chartData.title, unitSuffix, isRaw
            );

            const avg = State.metricsData[chartDivId].avg;
            const theme = getThemeLayout();
            const mSize = get2DMarkerSize();

            Plotly.react(chartDivId, [
                {
                    x: xLabels, y: filteredDims, type: 'scatter', mode: 'lines+markers',
                    line: { color: lineColor }, marker: { size: mSize }, name: 'Measurement', connectgaps: false,
                    hovertemplate: `<b>%{x}</b><br>${yAxisTitle.split(' ')[0]}: <b>%{y:.3f}${unitSuffix}</b><extra></extra>`
                },
                getAvgTrace(xLabels, avg)
            ], {
                margin: { l: 75, r: 20, b: 70, t: 10 },
                xaxis: { title: xAxisTitle, tickangle: 45, type: 'category', gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor },
                yaxis: {
                    title: { text: yAxisTitle, standoff: 15 },
                    automargin: true, tickformat: '.3f', gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor,
                    ...getManualYAxisConfig(`minDim_${idx}`, `maxDim_${idx}`)
                },
                paper_bgcolor: theme.paper_bgcolor,
                plot_bgcolor: theme.plot_bgcolor,
                font: { color: theme.fontColor },
                showlegend: false,
                shapes: getToleranceShapes(
                    parseFloat(document.getElementById(`nomDim_${idx}`)?.value),
                    parseFloat(document.getElementById(`tol1Dim_${idx}`)?.value),
                    parseFloat(document.getElementById(`tol2Dim_${idx}`)?.value),
                    parseFloat(document.getElementById(`tol3Dim_${idx}`)?.value)
                )
            }, { responsive: true });

            bindZoomSync(chartDivId);
            if (!opts.skipOverview) update3DOverview();
        }
        window.renderCustomDimChart = renderCustomDimChart;

        function addDimensionChart() {
            const mode = UI.selDimMode.value;
            const metric = UI.selMetricType.value;
            const metricName = UI.selMetricType.options[UI.selMetricType.selectedIndex].text;
            const valA = UI.selPointA.value;
            const valB = UI.selPointB.value;
            const ptAName = UI.selPointA.options[UI.selPointA.selectedIndex]?.text || '';
            const ptBName = UI.selPointB.options[UI.selPointB.selectedIndex]?.text || '';

            if (mode === 'internal' && valA === valB) {
                showNotification("Please select two distinct points.", "error");
                return;
            }

            const config = { mode, metric, metricName, valA, valB, ptAName, ptBName };
            UI.emptyDimensionMsg.classList.add('hidden');
            addDimensionChartProgrammatic(config);
        }

        function createCompactNumInput(id, placeholder, classes, val, onInputFn, onChangeFn, title = '') {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.id = id;
            inp.placeholder = placeholder;
            inp.step = 'any';
            inp.className = classes;
            if (val !== undefined && val !== null && val !== '') inp.value = String(val);
            if (title) inp.title = title;
            if (onInputFn) inp.addEventListener('input', onInputFn);
            if (onChangeFn) inp.addEventListener('change', onChangeFn);
            return inp;
        }

        function addDimensionChartProgrammatic(config, nom = '', t1 = '', t2 = '', t3 = '', fMin = '', fMax = '', yMin = '', yMax = '', customTitle = '') {
            const result = computeCustomDimData(config);
            if (!result) return;

            State.dimensionCharts++;
            const idx = State.dimensionCharts;
            const chartDivId = `dimChart_${idx}`;
            State.customDims[chartDivId] = {
                config,
                values: result.dimensions,
                labels: result.chartLabels,
                xAxisTitle: result.xAxisTitle,
                metric: config.metric,
                title: result.title
            };

            const debouncedRender = debounce(() => renderCustomDimChart(idx), 120);

            const wrapper = document.createElement('div');
            wrapper.className = 'custom-dim-card border border-slate-200 dark:border-slate-700 rounded-md p-4 bg-white dark:bg-slate-800 relative chart-controls flex flex-col w-full';

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'absolute top-2 right-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1';
            delBtn.setAttribute('aria-label', `Delete ${result.title}`);
            delBtn.title = 'Remove Chart';
            const delIcon = document.createElement('i');
            delIcon.className = 'fa-solid fa-xmark';
            delBtn.appendChild(delIcon);
            delBtn.addEventListener('click', () => deleteCustomChart(chartDivId, wrapper));
            wrapper.appendChild(delBtn);

            // Header container
            const header = document.createElement('div');
            header.className = 'flex flex-col items-start mb-2 gap-3 w-full';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'w-full break-words min-w-0 pr-8';
            const resolvedTitle = (customTitle && String(customTitle).trim()) ? String(customTitle).trim() : result.title;
            State.customDims[chartDivId].defaultTitle = result.title;
            State.customDims[chartDivId].title = resolvedTitle;
            State.chartTitles[chartDivId] = resolvedTitle;
            const h4 = document.createElement('input');
            h4.type = 'text';
            h4.id = `title_${chartDivId}`;
            h4.value = resolvedTitle;
            h4.setAttribute('aria-label', 'Edit custom chart title');
            h4.title = 'Click to edit chart title';
            h4.className = 'chart-title-input font-medium text-slate-700 dark:text-slate-200 text-sm w-full';
            h4.addEventListener('input', (e) => onChartTitleChange(chartDivId, e.target.value));
            const statsDiv = document.createElement('div');
            statsDiv.id = `stats_${chartDivId}`;
            statsDiv.className = 'text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1.5 bg-slate-100/80 dark:bg-slate-700/50 inline-block px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 transition-colors';
            statsDiv.textContent = 'Avg: --';
            titleWrap.appendChild(h4);
            titleWrap.appendChild(statsDiv);
            header.appendChild(titleWrap);

            // Controls bar
            const ctrlBar = document.createElement('div');
            ctrlBar.className = 'flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-900/30 p-1.5 rounded border border-slate-200 dark:border-slate-700 w-full';

            // Data filter group
            const filterGrp = document.createElement('div');
            filterGrp.className = 'flex items-center gap-1 border-r border-slate-300 dark:border-slate-600 pr-2';
            const filterLbl = document.createElement('span');
            filterLbl.className = 'text-[9px] text-slate-500 dark:text-slate-400 uppercase text-center leading-tight';
            filterLbl.innerHTML = 'Data<br>Filter';
            filterGrp.appendChild(filterLbl);
            filterGrp.appendChild(createCompactNumInput(`fMinDim_${idx}`, 'Min', 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 dark:text-white', fMin, debouncedRender, null, 'Exclude data below this value'));
            filterGrp.appendChild(createCompactNumInput(`fMaxDim_${idx}`, 'Max', 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 dark:text-white', fMax, debouncedRender, null, 'Exclude data above this value'));
            ctrlBar.appendChild(filterGrp);

            // Axis scale group
            const scaleGrp = document.createElement('div');
            scaleGrp.className = 'flex items-center gap-1 border-r border-slate-300 dark:border-slate-600 pr-2';
            const scaleLbl = document.createElement('span');
            scaleLbl.className = 'text-[9px] text-slate-500 dark:text-slate-400 uppercase text-center leading-tight';
            scaleLbl.innerHTML = 'Axis<br>Scale';
            scaleGrp.appendChild(scaleLbl);
            const onScaleChange = () => applyScale(chartDivId, `minDim_${idx}`, `maxDim_${idx}`);
            scaleGrp.appendChild(createCompactNumInput(`minDim_${idx}`, 'Min', 'dark:bg-slate-700 dark:border-slate-600 dark:text-white', yMin, null, onScaleChange));
            scaleGrp.appendChild(createCompactNumInput(`maxDim_${idx}`, 'Max', 'dark:bg-slate-700 dark:border-slate-600 dark:text-white', yMax, null, onScaleChange));
            ctrlBar.appendChild(scaleGrp);

            // Tolerance group
            const tolGrp = document.createElement('div');
            tolGrp.className = 'flex items-center gap-1';
            tolGrp.appendChild(createCompactNumInput(`nomDim_${idx}`, 'Nom', 'w-14 dark:bg-slate-700 dark:border-slate-600 dark:text-white', nom, debouncedRender));

            const pmSpan = document.createElement('span');
            pmSpan.className = 'text-xs text-slate-400';
            pmSpan.textContent = '±';
            tolGrp.appendChild(pmSpan);

            tolGrp.appendChild(createCompactNumInput(`tol1Dim_${idx}`, 'T1', 'w-12 dark:bg-slate-700 dark:border-slate-600 dark:text-white', t1, debouncedRender));
            const s1 = document.createElement('span'); s1.className = 'text-[10px] text-slate-400'; s1.textContent = '/'; tolGrp.appendChild(s1);
            tolGrp.appendChild(createCompactNumInput(`tol2Dim_${idx}`, 'T2', 'w-12 dark:bg-slate-700 dark:border-slate-600 dark:text-white', t2, debouncedRender));
            const s2 = document.createElement('span'); s2.className = 'text-[10px] text-slate-400'; s2.textContent = '/'; tolGrp.appendChild(s2);
            tolGrp.appendChild(createCompactNumInput(`tol3Dim_${idx}`, 'T3', 'w-12 dark:bg-slate-700 dark:border-slate-600 dark:text-white', t3, debouncedRender));

            const sigmaBtn = document.createElement('button');
            sigmaBtn.className = 'px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60 rounded transition-colors';
            sigmaBtn.title = 'Auto-fill T2 (1σ) & T3 (3σ) from empirical distribution';
            sigmaBtn.textContent = 'σ';
            sigmaBtn.addEventListener('click', () => autoFillSigmaTolerances(chartDivId));
            tolGrp.appendChild(sigmaBtn);
            ctrlBar.appendChild(tolGrp);

            // Download PNG button
            const camWrap = document.createElement('div');
            camWrap.className = 'border-l border-slate-300 dark:border-slate-600 pl-1';
            const camBtn = document.createElement('button');
            camBtn.className = 'text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1';
            camBtn.title = 'Download PNG';
            camBtn.setAttribute('aria-label', `Download ${result.title} PNG`);
            const camIcon = document.createElement('i');
            camIcon.className = 'fa-solid fa-camera';
            camBtn.appendChild(camIcon);
            camBtn.addEventListener('click', () => downloadPlot(chartDivId, result.title));
            camWrap.appendChild(camBtn);
            ctrlBar.appendChild(camWrap);

            header.appendChild(ctrlBar);
            wrapper.appendChild(header);

            // Plot container
            const plotDiv = document.createElement('div');
            plotDiv.id = chartDivId;
            plotDiv.className = 'w-full flex-1 min-h-[250px]';
            wrapper.appendChild(plotDiv);

            UI.dynamicChartsContainer.appendChild(wrapper);
            State.active2DCharts.add(chartDivId);

            if (State.rawPoints && State.rawPoints.length > 0) {
                renderCustomDimChart(idx);
            }
        }

        function addNeighborPreset(metricType) {
            if (State.centroids.length === 0) {
                showNotification("Please process coordinate data first.", "error");
                return;
            }
            const currentMode = UI.selDimMode.value;
            const currentMetric = UI.selMetricType.value;

            ['neighbor_1', 'neighbor_2', 'neighbor_3'].forEach(mode => {
                UI.selDimMode.value = mode;
                toggleDimMode();
                UI.selMetricType.value = metricType;
                addDimensionChart();
            });

            UI.selDimMode.value = currentMode;
            toggleDimMode();
            UI.selMetricType.value = currentMetric;
        }
        window.addNeighborPreset = addNeighborPreset;

        function deleteCustomChart(chartId, element) {
            delete State.customDims[chartId];
            delete State.metricFails[chartId];
            delete State.metricsData[chartId];
            State.activeFailFilters.delete(chartId);
            State.knownMetrics.delete(chartId);
            State.active2DCharts.delete(chartId);

            element.remove();
            if (Object.keys(State.customDims).length === 0) {
                UI.emptyDimensionMsg.classList.remove('hidden');
            }
            update3DOverview();
        }

        function hideDefaultChart(plotId, wrapperId, metricId) {
            State.hiddenCharts.add(plotId);
            const el = document.getElementById(wrapperId);
            if (el) {
                el.classList.add('hidden');
                el.classList.remove('flex');
            }
            State.activeFailFilters.delete(metricId);
            update3DOverview();
            const btnRestore = document.getElementById('btnRestoreCharts');
            if (btnRestore) btnRestore.classList.remove('hidden');
        }
        window.hideDefaultChart = hideDefaultChart;

        function restoreDefaultCharts() {
            State.hiddenCharts.clear();
            const defaultCharts = [
                { wrap: 'wrapper_stepX' },
                { wrap: 'wrapper_stepY' },
                { wrap: 'wrapper_angle' },
                { wrap: 'wrapper_bbX' },
                { wrap: 'wrapper_bbY' }
            ];
            defaultCharts.forEach(c => {
                const el = document.getElementById(c.wrap);
                if (el) {
                    el.classList.remove('hidden');
                    el.classList.add('flex');
                }
            });
            const btnRestore = document.getElementById('btnRestoreCharts');
            if (btnRestore) btnRestore.classList.add('hidden');
            setTimeout(() => resizeAllPlots(), 80);
        }
        window.restoreDefaultCharts = restoreDefaultCharts;

        /* =========================================================================
         * Logo Upload, Settings Export/Import, Folder Handle Persistence & PDF
         * ========================================================================= */
        function handleLogoUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            const isPNG = file.type === 'image/png';
            const isJPG = file.type === 'image/jpeg' || file.type === 'image/jpg';
            if (!isPNG && !isJPG) {
                showNotification("Please upload a valid PNG or JPG image.", "error");
                UI.inpLogoUpload.value = '';
                return;
            }
            State.logoFormat = isPNG ? 'PNG' : 'JPEG';
            const reader = new FileReader();
            reader.onload = function(e) {
                State.logoDataUrl = e.target.result;
                UI.logoPreview.src = State.logoDataUrl;
                UI.logoPreviewContainer.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }

        function removeLogo() {
            State.logoDataUrl = null;
            State.logoFormat = null;
            UI.inpLogoUpload.value = '';
            UI.logoPreview.src = '';
            UI.logoPreviewContainer.classList.add('hidden');
        }

        function buildSettingsObject(includePartInfo = true) {
            const settings = {
                ...(includePartInfo ? {
                    partNum: document.getElementById('inpPartNum').value,
                    serialNum: document.getElementById('inpSerialNum').value
                } : {}),
                comments: document.getElementById('inpComments').value,
                threshold: document.getElementById('inpThreshold').value,
                units: State.units,
                selectedAxisIndex: State.selectedAxisIndex,
                targetAngle: UI.inpTargetAngle ? UI.inpTargetAngle.value : '',
                invertX: document.getElementById('chkInvertX').checked,
                invertY: document.getElementById('chkInvertY').checked,
                companyName: document.getElementById('inpCompanyName').value,
                accentColor: document.getElementById('inpAccentColor').value,
                markerColor: document.getElementById('inpMarkerColor').value,
                centroidColor: document.getElementById('inpCentroidColor').value,
                markerSize: document.getElementById('inpMarkerSize').value,
                centroidSize: document.getElementById('inpCentroidSize').value,
                showLabels: document.getElementById('chkShowLabels').checked,
                highlightTol: document.getElementById('chkHighlightTol').checked,
                overviewView: State.overviewView,
                isEqualAxes: State.isEqualAxes,
                darkTheme: document.documentElement.classList.contains('dark'),
                layoutMode: document.getElementById('selLayoutMode').value,
                point2DSize: document.getElementById('inp2DMarkerSize').value,
                exportFontSize: getExportFontSize(),
                chartTitles: getAllChartTitles(),
                hiddenCharts: Array.from(State.hiddenCharts),
                logoDataUrl: State.logoDataUrl,
                logoFormat: State.logoFormat,
                tolerances: {},
                filters: {},
                scales: {},
                customDimsConfig: []
            };

            const metrics = ['StepX', 'StepY', 'Angle', 'BBX', 'BBY'];
            metrics.forEach(m => {
                settings.tolerances[m] = {
                    nom: document.getElementById(`inpNom${m}`)?.value || '',
                    t1: document.getElementById(`inpTol1${m}`)?.value || '',
                    t2: document.getElementById(`inpTol2${m}`)?.value || '',
                    t3: document.getElementById(`inpTol3${m}`)?.value || ''
                };
                settings.filters[m] = {
                    min: document.getElementById(`fMin${m}`)?.value || '',
                    max: document.getElementById(`fMax${m}`)?.value || ''
                };
                settings.scales[m] = {
                    min: document.getElementById(`min${m}`)?.value || '',
                    max: document.getElementById(`max${m}`)?.value || ''
                };
            });

            for (const id in State.customDims) {
                const dim = State.customDims[id];
                const idx = id.split('_')[1];
                settings.customDimsConfig.push({
                    config: dim.config,
                    title: getChartTitle(id, dim.title),
                    nom: document.getElementById(`nomDim_${idx}`)?.value || '',
                    t1: document.getElementById(`tol1Dim_${idx}`)?.value || '',
                    t2: document.getElementById(`tol2Dim_${idx}`)?.value || '',
                    t3: document.getElementById(`tol3Dim_${idx}`)?.value || '',
                    fMin: document.getElementById(`fMinDim_${idx}`)?.value || '',
                    fMax: document.getElementById(`fMaxDim_${idx}`)?.value || '',
                    yMin: document.getElementById(`minDim_${idx}`)?.value || '',
                    yMax: document.getElementById(`maxDim_${idx}`)?.value || ''
                });
            }
            return settings;
        }

        function exportSettings() {
            // Omit Part Number and Serial Number from reusable configuration templates
            const settings = buildSettingsObject(false);
            const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", url);
            downloadAnchorNode.setAttribute("download", "ATA_Settings.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showNotification("Settings exported successfully.", "success");
        }
        window.exportSettings = exportSettings;

        function importSettings(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const settings = JSON.parse(e.target.result);

                    const setVal = (id, val) => { if (val !== undefined && document.getElementById(id)) document.getElementById(id).value = val; };
                    const setChk = (id, val) => { if (val !== undefined && document.getElementById(id)) document.getElementById(id).checked = Boolean(val); };

                    // Deliberately preserve current Part Number and Serial Number
                    setVal('inpComments', settings.comments);
                    setVal('inpThreshold', settings.threshold);
                    if (settings.units !== undefined) {
                        State.units = settings.units;
                        setVal('selUnits', settings.units);
                    }
                    if (settings.selectedAxisIndex !== undefined) {
                        State.selectedAxisIndex = settings.selectedAxisIndex;
                    }
                    if (settings.targetAngle !== undefined) {
                        setVal('inpTargetAngle', settings.targetAngle);
                        State.targetAngle = settings.targetAngle !== '' ? parseFloat(settings.targetAngle) : null;
                    }
                    setChk('chkInvertX', settings.invertX);
                    setChk('chkInvertY', settings.invertY);

                    if (settings.companyName !== undefined) {
                        setVal('inpCompanyName', settings.companyName);
                        const name = settings.companyName.trim() || 'AF ENGINEERING TOOLS';
                        if (UI.sidebarCompanyText) UI.sidebarCompanyText.textContent = name.toUpperCase();
                        document.title = `Aperture Tolerance Analyzer - ${name}`;
                    }
                    setVal('inpAccentColor', settings.accentColor);
                    setVal('inpMarkerColor', settings.markerColor);
                    setVal('inpCentroidColor', settings.centroidColor);
                    setVal('inpMarkerSize', settings.markerSize);
                    setVal('inpCentroidSize', settings.centroidSize);
                    setChk('chkShowLabels', settings.showLabels);
                    setChk('chkHighlightTol', settings.highlightTol);

                    if (settings.overviewView) State.overviewView = settings.overviewView;
                    if (typeof settings.isEqualAxes === 'boolean') {
                        State.isEqualAxes = settings.isEqualAxes;
                        updateEqualAxesButtonUI();
                    }
                    if (typeof settings.darkTheme === 'boolean') {
                        document.documentElement.classList.toggle('dark', settings.darkTheme);
                    }

                    if (settings.layoutMode !== undefined) {
                        setVal('selLayoutMode', settings.layoutMode);
                        updateLayoutMode();
                    }
                    if (settings.point2DSize !== undefined) setVal('inp2DMarkerSize', settings.point2DSize);
                    if (settings.exportFontSize !== undefined) setVal('inpExportFontSize', settings.exportFontSize);
                    if (settings.chartTitles && typeof settings.chartTitles === 'object') {
                        Object.entries(settings.chartTitles).forEach(([pid, titleVal]) => {
                            if (typeof titleVal === 'string' && titleVal.trim()) {
                                State.chartTitles[pid] = titleVal.trim();
                                const titleInput = document.getElementById(`title_${pid}`);
                                if (titleInput) titleInput.value = titleVal.trim();
                            }
                        });
                    }

                    if (settings.logoDataUrl) {
                        State.logoDataUrl = settings.logoDataUrl;
                        State.logoFormat = settings.logoFormat || 'PNG';
                        UI.logoPreview.src = State.logoDataUrl;
                        UI.logoPreviewContainer.classList.remove('hidden');
                    } else {
                        removeLogo();
                    }

                    restoreDefaultCharts();
                    if (settings.hiddenCharts && Array.isArray(settings.hiddenCharts)) {
                        const plotToInfo = {
                            plotStepX: { wrap: 'wrapper_stepX', metric: 'stepX' },
                            plotStepY: { wrap: 'wrapper_stepY', metric: 'stepY' },
                            plotAngle: { wrap: 'wrapper_angle', metric: 'angle' },
                            plotBBX: { wrap: 'wrapper_bbX', metric: 'bbX' },
                            plotBBY: { wrap: 'wrapper_bbY', metric: 'bbY' }
                        };
                        settings.hiddenCharts.forEach(plotId => {
                            if (plotToInfo[plotId]) {
                                hideDefaultChart(plotId, plotToInfo[plotId].wrap, plotToInfo[plotId].metric);
                            }
                        });
                    }

                    const metrics = ['StepX', 'StepY', 'Angle', 'BBX', 'BBY'];
                    metrics.forEach(m => {
                        if (settings.tolerances?.[m]) {
                            setVal(`inpNom${m}`, settings.tolerances[m].nom);
                            setVal(`inpTol1${m}`, settings.tolerances[m].t1);
                            setVal(`inpTol2${m}`, settings.tolerances[m].t2);
                            setVal(`inpTol3${m}`, settings.tolerances[m].t3);
                        }
                        if (settings.filters?.[m]) {
                            setVal(`fMin${m}`, settings.filters[m].min);
                            setVal(`fMax${m}`, settings.filters[m].max);
                        }
                        if (settings.scales?.[m]) {
                            setVal(`min${m}`, settings.scales[m].min);
                            setVal(`max${m}`, settings.scales[m].max);
                        }
                    });

                    // Reset and rebuild custom dimension charts
                    UI.dynamicChartsContainer.querySelectorAll('.custom-dim-card').forEach(el => el.remove());
                    State.customDims = {};
                    State.dimensionCharts = 0;
                    State.active2DCharts = new Set(['plotStepX', 'plotStepY', 'plotAngle', 'plotBBX', 'plotBBY']);

                    Object.keys(State.metricsData).forEach(mId => {
                        if (mId.startsWith('dimChart_')) {
                            delete State.metricsData[mId];
                            delete State.metricFails[mId];
                            State.activeFailFilters.delete(mId);
                            State.knownMetrics.delete(mId);
                        }
                    });

                    if (Array.isArray(settings.customDimsConfig) && settings.customDimsConfig.length > 0) {
                        UI.emptyDimensionMsg.classList.add('hidden');
                        settings.customDimsConfig.forEach(dim => {
                            addDimensionChartProgrammatic(
                                dim.config,
                                dim.nom, dim.t1, dim.t2, dim.t3,
                                dim.fMin, dim.fMax,
                                dim.yMin, dim.yMax,
                                dim.title || ''
                            );
                        });
                    } else {
                        UI.emptyDimensionMsg.classList.remove('hidden');
                    }

                    // Automatically invoke the blue σ recalculation when data is present
                    if (State.originalRawPoints && State.originalRawPoints.length > 0) {
                        State.autoSigmaOnNextProcess = true;
                        applyModificationsAndProcess();
                    } else {
                        updateAllChartsTheme();
                    }

                    showNotification("Settings imported (Part/Serial preserved; σ tolerances updated).", "success");
                } catch (err) {
                    console.error("Import error:", err);
                    showNotification("Failed to parse settings file.", "error");
                }
                event.target.value = '';
            };
            reader.readAsText(file);
        }
        window.importSettings = importSettings;

        /* =========================================================================
         * IndexedDB Helpers for Persisting Last Export Folder Handle
         * ========================================================================= */
        function openHandleDB() {
            return new Promise((resolve, reject) => {
                if (!window.indexedDB) {
                    reject(new Error('IndexedDB unavailable'));
                    return;
                }
                const req = indexedDB.open('ATA_Preferences_DB', 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('handles')) {
                        db.createObjectStore('handles');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function saveLastDirHandle(handle) {
            State.lastDirHandle = handle;
            updateSavedFolderUI();
            try {
                const db = await openHandleDB();
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(handle, 'lastExportDir');
            } catch (err) {
                console.warn('Could not persist folder handle in IndexedDB:', err);
            }
        }

        async function loadLastDirHandle() {
            try {
                const db = await openHandleDB();
                const handle = await new Promise((resolve, reject) => {
                    const tx = db.transaction('handles', 'readonly');
                    const req = tx.objectStore('handles').get('lastExportDir');
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => reject(req.error);
                });
                if (handle) {
                    State.lastDirHandle = handle;
                    updateSavedFolderUI();
                }
            } catch (err) {
                console.warn('Could not load saved folder handle from IndexedDB:', err);
            }
        }

        function updateSavedFolderUI() {
            if (!UI.savedFolderBar || !UI.savedFolderName) return;
            if (State.lastDirHandle && State.lastDirHandle.name) {
                UI.savedFolderName.textContent = State.lastDirHandle.name;
                UI.savedFolderBar.classList.remove('hidden');
                UI.savedFolderBar.classList.add('flex');
            } else {
                UI.savedFolderBar.classList.add('hidden');
                UI.savedFolderBar.classList.remove('flex');
            }
        }

        async function verifyDirPermission(handle) {
            if (!handle) return false;
            try {
                const opts = { mode: 'readwrite' };
                if (typeof handle.queryPermission === 'function') {
                    if ((await handle.queryPermission(opts)) === 'granted') return true;
                }
                if (typeof handle.requestPermission === 'function') {
                    if ((await handle.requestPermission(opts)) === 'granted') return true;
                }
            } catch (err) {
                console.warn('Permission check failed for saved folder handle:', err);
            }
            return false;
        }

        async function changeExportFolder() {
            if (typeof window.showDirectoryPicker !== 'function') {
                showNotification("Folder picker is not supported in this browser; exports will download as a ZIP.", "info");
                return;
            }
            try {
                const pickerOpts = { mode: 'readwrite' };
                if (State.lastDirHandle) pickerOpts.startIn = State.lastDirHandle;
                let dirHandle = null;
                try {
                    dirHandle = await window.showDirectoryPicker(pickerOpts);
                } catch (startInErr) {
                    if (startInErr && startInErr.name === 'AbortError') return;
                    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                }
                if (dirHandle) {
                    await saveLastDirHandle(dirHandle);
                    showNotification(`Export folder set to "${dirHandle.name}".`, "success");
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn("Could not change export folder:", err);
                showNotification("Could not access folder picker in this browser context.", "error");
            }
        }

        /* =========================================================================
         * PNG Download, Shared PDF Report Builder & Save All to Folder
         * ========================================================================= */
        function getMetricIdForPlot(plotId) {
            const map = {
                plotStepX: 'stepX',
                plotStepY: 'stepY',
                plotAngle: 'angle',
                plotBBX: 'bbX',
                plotBBY: 'bbY'
            };
            if (map[plotId]) return map[plotId];
            if (plotId && plotId.startsWith('dimChart_')) return plotId;
            return null;
        }

        function formatMetricFailsSummary(m) {
            if (!m) return '';
            const fmtTier = (label, tVal, fails) => {
                if (tVal === null || isNaN(tVal)) return `${label}: --`;
                const pct = m.totalValid > 0 ? ((fails / m.totalValid) * 100).toFixed(1) : '0.0';
                return `${label} (±${tVal}): ${fails}/${m.totalValid} (${pct}% fail)`;
            };
            return `Out-of-Tol Fails  —  ${[
                fmtTier('T1', m.t1, m.fails1),
                fmtTier('T2', m.t2, m.fails2),
                fmtTier('T3', m.t3, m.fails3)
            ].join('   |   ')}`;
        }

        function formatMetricSummaryLine(m) {
            if (!m) return '';
            const avgStr = `Avg: ${m.avg.toFixed(3)}${m.unit}`;
            const nomStr = !isNaN(m.nom) ? `Nom: ${m.nom.toFixed(3)}${m.unit}` : 'Nom: --';
            const fmtTier = (label, tVal, fails) => {
                if (tVal === null || isNaN(tVal)) return `${label}: --`;
                const pct = m.totalValid > 0 ? ((fails / m.totalValid) * 100).toFixed(1) : '0.0';
                return `${label} (±${tVal}): ${fails}/${m.totalValid} (${pct}% fail)`;
            };
            return [
                avgStr,
                nomStr,
                `Fails — ${fmtTier('T1', m.t1, m.fails1)}`,
                fmtTier('T2', m.t2, m.fails2),
                fmtTier('T3', m.t3, m.fails3)
            ].join('  |  ');
        }

        /**
         * Builds a cloned Plotly { data, layout } payload annotated with a high-legibility
         * title, Average / Nominal / Out-of-Tolerance Fail summary, and scaled fonts for PNG exports.
         */
        function buildExportChartPayload(plotEl, plotId, chartTitle) {
            const exportData = JSON.parse(JSON.stringify(plotEl.data || []));
            const exportLayout = JSON.parse(JSON.stringify(plotEl.layout || {}));
            const theme = getThemeLayout();
            const isDark = document.documentElement.classList.contains('dark');
            const subColor = isDark ? '#cbd5e1' : '#475569';

            const metricId = getMetricIdForPlot(plotId);
            const metric = metricId ? State.metricsData[metricId] : null;
            const esc = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            const baseFont = getExportFontSize();
            const titleFontSize = Math.round(baseFont * 1.45);
            const sub1FontSize = Math.round(baseFont * 1.0);
            const sub2FontSize = Math.round(baseFont * 0.9);
            const axisTitleSize = Math.round(baseFont * 1.15);
            const axisTickSize = baseFont;
            const legendFontSize = Math.round(baseFont * 0.9);
            const resolvedTitle = getChartTitle(plotId, chartTitle || plotId);
            const canvasH = plotId === 'plotOverview' ? 1200 : 600;

            let titleHtml = `<b>${esc(resolvedTitle)}</b>`;
            let titleLinesHeight = Math.round(titleFontSize * 1.45);
            if (metric) {
                const nomText = !isNaN(metric.nom) ? `${metric.nom.toFixed(3)}${metric.unit}` : '--';
                const line1 = `Avg: ${metric.avg.toFixed(3)}${metric.unit}   |   Nom: ${nomText}`;
                const line2 = formatMetricFailsSummary(metric);
                titleHtml += `<br><span style="font-size:${sub1FontSize}px;color:${subColor}">${esc(line1)}</span>`;
                titleHtml += `<br><span style="font-size:${sub2FontSize}px;color:${subColor}">${esc(line2)}</span>`;
                titleLinesHeight += Math.round((sub1FontSize + sub2FontSize) * 1.45);
            } else if (plotId === 'plotOverview') {
                const partNo = UI.inpPartNum.value.trim() || 'N/A';
                const serialNo = UI.inpSerialNum.value.trim() || 'N/A';
                const line1 = `Part: ${partNo}   |   Serial: ${serialNo}   |   Points: ${State.rawPoints.length}   |   Apertures: ${State.apertures.length}`;
                titleHtml += `<br><span style="font-size:${sub1FontSize}px;color:${subColor}">${esc(line1)}</span>`;
                titleLinesHeight += Math.round(sub1FontSize * 1.45);
            }

            // Push title downward from top edge so ascenders of large fonts never clip
            const titleTopOffsetPx = Math.round(titleFontSize * 0.75 + 22);
            const titleY = Math.max(0.84, 1 - (titleTopOffsetPx / canvasH));

            exportLayout.title = {
                text: titleHtml,
                font: { size: titleFontSize, color: theme.fontColor },
                x: 0.5,
                xanchor: 'center',
                y: titleY,
                yref: 'container',
                yanchor: 'top',
                pad: { t: 0, b: Math.round(baseFont * 0.6) }
            };

            const scaleAxisFonts = (ax, titleSize = axisTitleSize, tickSize = axisTickSize, enableAutoMargin = true) => {
                if (!ax) return;
                if (typeof ax.title === 'string') {
                    ax.title = { text: ax.title };
                } else {
                    ax.title = ax.title || {};
                }
                ax.title.font = { ...(ax.title.font || {}), size: titleSize, color: theme.fontColor };
                ax.title.standoff = Math.max(16, Math.round(baseFont * 0.85));
                ax.tickfont = { ...(ax.tickfont || {}), size: tickSize, color: theme.fontColor };
                if (enableAutoMargin) ax.automargin = true;
            };

            exportLayout.font = { ...(exportLayout.font || {}), size: baseFont, color: theme.fontColor };
            scaleAxisFonts(exportLayout.xaxis, axisTitleSize, axisTickSize, true);
            scaleAxisFonts(exportLayout.yaxis, axisTitleSize, axisTickSize, true);
            if (exportLayout.scene) {
                scaleAxisFonts(exportLayout.scene.xaxis, Math.round(baseFont * 1.05), Math.round(baseFont * 0.8), false);
                scaleAxisFonts(exportLayout.scene.yaxis, Math.round(baseFont * 1.05), Math.round(baseFont * 0.8), false);
                scaleAxisFonts(exportLayout.scene.zaxis, Math.round(baseFont * 1.05), Math.round(baseFont * 0.8), false);
            }
            if (exportLayout.legend) {
                exportLayout.legend.font = { ...(exportLayout.legend.font || {}), size: legendFontSize, color: theme.fontColor };
            }

            // Respect user-selected 2D Pts marker size on exported images
            const user2DSize = get2DMarkerSize();
            exportData.forEach(trace => {
                if (plotId === 'plotOverview') {
                    if (trace.textfont) trace.textfont.size = Math.max(trace.textfont.size || 12, Math.round(baseFont * 0.9));
                } else {
                    if (trace.line) trace.line.width = Math.max(trace.line.width || 2, 2.5);
                    if (trace.marker) trace.marker.size = user2DSize;
                }
            });

            // Generous dynamic margins below the lowered title block
            const topMargin = Math.max(135, titleTopOffsetPx + titleLinesHeight + Math.round(baseFont * 0.8) + 20);
            const leftMargin = Math.max(110, Math.round(axisTitleSize + axisTickSize * 3.2 + 40));
            const rightMargin = Math.max(55, Math.round(baseFont * 1.5 + 25));
            const bottomMargin = Math.max(95, Math.round(axisTitleSize + axisTickSize * 2.2 + 40));
            const marginPad = Math.max(8, Math.round(baseFont * 0.35));

            if (plotId === 'plotOverview') {
                exportLayout.margin = exportLayout.scene
                    ? { l: 30, r: 30, b: 30, t: topMargin, pad: marginPad }
                    : { l: leftMargin, r: rightMargin, b: bottomMargin, t: topMargin, pad: marginPad };
            } else {
                exportLayout.margin = { l: leftMargin, r: rightMargin, b: bottomMargin, t: topMargin, pad: marginPad };
            }

            return { data: exportData, layout: exportLayout };
        }

        async function downloadPlot(plotId, chartTitle) {
            const partNum = sanitizeFilenamePart(UI.inpPartNum.value) || "Unknown_Part";
            const serialNum = sanitizeFilenamePart(UI.inpSerialNum.value) || "No_SN";
            const el = document.getElementById(plotId);
            if (!el || !el.layout) return;

            const resolvedTitle = getChartTitle(plotId, chartTitle);
            const safeFilename = `${partNum}_${serialNum}_${sanitizeFilenamePart(resolvedTitle)}.png`;
            const pxW = plotId === 'plotOverview' ? 1600 : 1800;
            const pxH = plotId === 'plotOverview' ? 1200 : 600;
            const payload = buildExportChartPayload(el, plotId, resolvedTitle);
            const pngDataUrl = await Plotly.toImage(payload, { format: 'png', width: pxW, height: pxH });

            const a = document.createElement('a');
            a.href = pngDataUrl;
            a.download = safeFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
        }
        window.downloadPlot = downloadPlot;

        function getExportablePlots(printWidth) {
            const chart2DHeight = Math.round(printWidth / 3);
            const plots = [
                { id: 'plotOverview', metricId: null, title: getChartTitle('plotOverview', '3D Array Overview'), h: Math.min(printWidth * 0.82, 145) },
                { id: 'plotStepX', metricId: 'stepX', title: getChartTitle('plotStepX', 'X-Lattice'), h: chart2DHeight },
                { id: 'plotStepY', metricId: 'stepY', title: getChartTitle('plotStepY', 'Y-Lattice'), h: chart2DHeight },
                { id: 'plotAngle', metricId: 'angle', title: getChartTitle('plotAngle', 'Lattice Angle'), h: chart2DHeight },
                { id: 'plotBBX', metricId: 'bbX', title: getChartTitle('plotBBX', 'Aperture Width'), h: chart2DHeight },
                { id: 'plotBBY', metricId: 'bbY', title: getChartTitle('plotBBY', 'Aperture Height'), h: chart2DHeight }
            ].filter(p => p.id === 'plotOverview' || !State.hiddenCharts.has(p.id));

            for (let i = 1; i <= State.dimensionCharts; i++) {
                const chartDivId = `dimChart_${i}`;
                if (State.customDims[chartDivId] && document.getElementById(chartDivId)) {
                    plots.push({
                        id: chartDivId,
                        metricId: chartDivId,
                        title: getChartTitle(chartDivId, State.customDims[chartDivId].title || `Custom Dimension ${i}`),
                        h: chart2DHeight
                    });
                }
            }
            return plots;
        }

        async function buildPDFReportDoc() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 15;
            const printWidth = pageWidth - (margin * 2);
            let cursorY = 42;

            const companyName = UI.inpCompanyName.value.trim() || "AF ENGINEERING TOOLS";
            const accentHex = UI.inpAccentColor.value || '#276193';
            const accent = hexToRgb(accentHex);
            const partNo = UI.inpPartNum.value.trim() || "N/A";
            const serialNo = UI.inpSerialNum.value.trim() || "N/A";
            let comments = (UI.inpComments?.value || "").replace(/\r?\n/g, ' ').trim();
            if (comments.length > 120) comments = comments.substring(0, 117) + '...';

            // --- SUMMARY TABLE ---
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(15, 23, 42);
            doc.text("Tolerance Summary", margin, cursorY);
            cursorY += 4;

            const hiddenMetricIds = new Set();
            if (State.hiddenCharts.has('plotStepX')) hiddenMetricIds.add('stepX');
            if (State.hiddenCharts.has('plotStepY')) hiddenMetricIds.add('stepY');
            if (State.hiddenCharts.has('plotAngle')) hiddenMetricIds.add('angle');
            if (State.hiddenCharts.has('plotBBX')) hiddenMetricIds.add('bbX');
            if (State.hiddenCharts.has('plotBBY')) hiddenMetricIds.add('bbY');

            const tableData = [];
            Object.values(State.metricsData).forEach(m => {
                if (hiddenMetricIds.has(m.id)) return;
                const hasT1 = m.t1 !== null;
                const hasT2 = m.t2 !== null;
                const hasT3 = m.t3 !== null;
                const pct1 = m.totalValid > 0 ? ((m.fails1 / m.totalValid) * 100).toFixed(2) : "0.00";
                const pct2 = m.totalValid > 0 ? ((m.fails2 / m.totalValid) * 100).toFixed(2) : "0.00";
                const pct3 = m.totalValid > 0 ? ((m.fails3 / m.totalValid) * 100).toFixed(2) : "0.00";
                tableData.push([
                    m.name,
                    `${m.avg.toFixed(3)}${m.unit}`,
                    !isNaN(m.nom) ? `${m.nom.toFixed(3)}${m.unit}` : '-',
                    hasT1 ? `±${m.t1}` : '-',
                    hasT1 ? `${m.fails1}/${m.totalValid} (${pct1}%)` : '-',
                    hasT2 ? `±${m.t2}` : '-',
                    hasT2 ? `${m.fails2}/${m.totalValid} (${pct2}%)` : '-',
                    hasT3 ? `±${m.t3}` : '-',
                    hasT3 ? `${m.fails3}/${m.totalValid} (${pct3}%)` : '-'
                ]);
            });

            if (tableData.length > 0) {
                doc.autoTable({
                    startY: cursorY,
                    head: [['Metric', 'Avg', 'Nom', 'T1', 'T1 Fails', 'T2', 'T2 Fails', 'T3', 'T3 Fails']],
                    body: tableData,
                    theme: 'grid',
                    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'center' },
                    columnStyles: {
                        0: { fontStyle: 'bold' },
                        1: { halign: 'center' },
                        2: { halign: 'center' },
                        3: { halign: 'center' },
                        4: { halign: 'center', textColor: [202, 138, 4] },
                        5: { halign: 'center' },
                        6: { halign: 'center', textColor: [234, 88, 12] },
                        7: { halign: 'center' },
                        8: { halign: 'center', textColor: [220, 38, 38] }
                    },
                    alternateRowStyles: { fillColor: [248, 250, 252] },
                    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [51, 65, 85] },
                    margin: { top: 42, left: margin, right: margin }
                });
                cursorY = doc.lastAutoTable.finalY + 14;
            } else {
                doc.setFontSize(10);
                doc.setFont("helvetica", "italic");
                doc.text("No tolerance metrics defined.", margin, cursorY + 5);
                cursorY += 14;
            }

            // --- CHARTS EXPORT ---
            const plotsToExport = getExportablePlots(printWidth);

            for (const p of plotsToExport) {
                const plotEl = document.getElementById(p.id);
                if (!plotEl || !plotEl.layout) continue;

                if (cursorY + p.h + 24 > pageHeight - margin - 10) {
                    doc.addPage();
                    cursorY = 42;
                }

                doc.setFontSize(13);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(30, 41, 59);
                doc.text(p.title, margin, cursorY);

                // Look up statistics by explicit metricId (prevents substring collision)
                const relatedMetric = p.metricId ? State.metricsData[p.metricId] : null;
                if (relatedMetric) {
                    const statText = formatMetricSummaryLine(relatedMetric);
                    doc.setFontSize(8.5);
                    doc.setFont("helvetica", "normal");
                    doc.setTextColor(100, 116, 139);
                    doc.text(statText, margin, cursorY + 6);
                } else if (p.id === 'plotOverview') {
                    let legX = margin;
                    const legY = cursorY + 6;
                    const drawLegItem = (color, label, isCentroid) => {
                        doc.setFillColor(color);
                        if (isCentroid) doc.rect(legX, legY - 2.5, 3, 3, 'F');
                        else doc.circle(legX + 1.5, legY - 1, 1.5, 'F');
                        doc.setFontSize(9);
                        doc.setFont("helvetica", "normal");
                        doc.setTextColor(100, 116, 139);
                        doc.text(label, legX + 5, legY);
                        legX += doc.getTextWidth(label) + 12;
                    };
                    drawLegItem(UI.inpMarkerColor.value || '#3b82f6', 'Normal Points', false);
                    drawLegItem(UI.inpCentroidColor.value || '#94a3b8', 'Centroid', true);
                    if (UI.chkHighlightTol.checked) {
                        drawLegItem('#eab308', 'T1', false);
                        drawLegItem('#f97316', 'T2', false);
                        drawLegItem('#ef4444', 'T3', false);
                    }
                }
                cursorY += 10;

                // Clone data & layout to guarantee crisp dark-text-on-light-background PDF rendering
                const exportData = JSON.parse(JSON.stringify(plotEl.data || []));
                exportData.forEach(trace => {
                    if (trace.textfont) trace.textfont.color = '#1e293b';
                });

                const basePdfFont = getExportFontSize();
                const user2DSizePdf = get2DMarkerSize();
                if (p.id !== 'plotOverview') {
                    exportData.forEach(trace => {
                        if (trace.marker) trace.marker.size = user2DSizePdf;
                    });
                }
                const exportLayout = JSON.parse(JSON.stringify(plotEl.layout || {}));
                const scaleFont = (ax, enableAutoMargin = true) => {
                    if (!ax) return;
                    ax.title = ax.title || {};
                    ax.title.font = { size: Math.round(basePdfFont * 1.25), color: '#334155' };
                    ax.title.standoff = Math.max(18, Math.round(basePdfFont * 1.0));
                    ax.tickfont = { size: basePdfFont, color: '#475569' };
                    if (enableAutoMargin) ax.automargin = true;
                };

                scaleFont(exportLayout.xaxis);
                scaleFont(exportLayout.yaxis);
                if (exportLayout.scene) {
                    scaleFont(exportLayout.scene.xaxis);
                    scaleFont(exportLayout.scene.yaxis);
                    scaleFont(exportLayout.scene.zaxis);
                }

                exportLayout.margin = { l: Math.max(120, Math.round(basePdfFont * 4.5 + 40)), r: Math.max(55, Math.round(basePdfFont * 1.5 + 25)), b: Math.max(105, Math.round(basePdfFont * 3.5 + 40)), t: Math.max(30, Math.round(basePdfFont * 1.2)), pad: Math.max(8, Math.round(basePdfFont * 0.35)) };
                exportLayout.paper_bgcolor = '#ffffff';
                exportLayout.plot_bgcolor = '#f8fafc';
                exportLayout.font = { ...exportLayout.font, color: '#334155' };
                if (exportLayout.legend) exportLayout.legend.font = { size: 20, color: '#334155' };

                if (p.id === 'plotOverview') {
                    exportLayout.paper_bgcolor = '#f1f5f9';
                    exportLayout.plot_bgcolor = '#e2e8f0';
                    if (exportLayout.xaxis) exportLayout.xaxis.gridcolor = '#ffffff';
                    if (exportLayout.yaxis) exportLayout.yaxis.gridcolor = '#ffffff';
                    if (exportLayout.scene) {
                        if (exportLayout.scene.xaxis) { exportLayout.scene.xaxis.backgroundcolor = '#e2e8f0'; exportLayout.scene.xaxis.gridcolor = '#ffffff'; }
                        if (exportLayout.scene.yaxis) { exportLayout.scene.yaxis.backgroundcolor = '#e2e8f0'; exportLayout.scene.yaxis.gridcolor = '#ffffff'; }
                        if (exportLayout.scene.zaxis) { exportLayout.scene.zaxis.backgroundcolor = '#e2e8f0'; exportLayout.scene.zaxis.gridcolor = '#ffffff'; }
                    }
                }

                const pxWidth = p.id === 'plotOverview' ? 1800 : 2100;
                const pxHeight = p.id === 'plotOverview' ? Math.round((p.h / printWidth) * pxWidth) : 700;
                const imgUrl = await Plotly.toImage({ data: exportData, layout: exportLayout }, { format: 'jpeg', width: pxWidth, height: pxHeight });

                doc.addImage(imgUrl, 'JPEG', margin, cursorY, printWidth, p.h);
                doc.setDrawColor(100, 116, 139);
                doc.setLineWidth(0.3);
                doc.rect(margin, cursorY, printWidth, p.h);

                cursorY += p.h + 14;
            }

            // --- HEADERS & FOOTERS ---
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);

                doc.setFillColor(accent.r, accent.g, accent.b);
                doc.rect(0, 0, pageWidth, 12, 'F');

                doc.setTextColor(255, 255, 255);
                doc.setFontSize(14);
                doc.setFont("helvetica", "bold");
                doc.text(companyName.toUpperCase(), margin, 8);

                doc.setFontSize(10);
                doc.setFont("helvetica", "normal");
                doc.text("Aperture Tolerance Report", pageWidth - margin, 8, { align: 'right' });

                if (State.logoDataUrl) {
                    const img = UI.logoPreview;
                    let logoH = 15, logoW = 15;
                    if (img.naturalHeight > 0) {
                        const aspect = img.naturalWidth / img.naturalHeight;
                        logoW = logoH * aspect;
                        if (logoW > 50) { logoW = 50; logoH = logoW / aspect; }
                    }
                    doc.addImage(State.logoDataUrl, State.logoFormat || 'PNG', pageWidth - margin - logoW, 16, logoW, logoH);
                }

                doc.setTextColor(30, 41, 59);
                doc.setFontSize(10);
                doc.setFont("helvetica", "bold");
                doc.text("Part No:", margin, 20);
                doc.setFont("helvetica", "normal");
                doc.text(partNo, margin + 17, 20);

                doc.setFont("helvetica", "bold");
                doc.text("Serial No:", margin + 65, 20);
                doc.setFont("helvetica", "normal");
                doc.text(serialNo, margin + 85, 20);

                if (comments) {
                    doc.setFont("helvetica", "bold");
                    doc.text("Notes:", margin, 26);
                    doc.setFont("helvetica", "italic");
                    doc.setTextColor(71, 85, 105);
                    doc.text(comments, margin + 13, 26);
                }

                doc.setDrawColor(accent.r, accent.g, accent.b);
                doc.setLineWidth(0.4);
                doc.line(margin, 32, pageWidth - margin, 32);

                doc.setFontSize(9);
                doc.setTextColor(148, 163, 184);
                doc.setFont("helvetica", "normal");
                doc.text(
                    `${companyName}  |  Date: ${new Date().toLocaleDateString()}  |  Page ${i} of ${pageCount}`,
                    pageWidth / 2,
                    pageHeight - 10,
                    { align: 'center' }
                );
            }

            const fnPart = partNo !== "N/A" ? `${sanitizeFilenamePart(partNo)}_` : '';
            const fnSerial = serialNo !== "N/A" ? `${sanitizeFilenamePart(serialNo)}_` : '';
            const filename = `${fnPart}${fnSerial}Analyzer_Report.pdf`;
            return { doc, filename };
        }

        async function downloadPDFReport() {
            if (!window.jspdf) {
                showNotification("PDF library is still loading. Please try again in a moment.", "error");
                return;
            }
            const originalBtnHTML = UI.btnDownloadPDF.innerHTML;
            UI.btnDownloadPDF.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
            UI.btnDownloadPDF.disabled = true;

            try {
                const { doc, filename } = await buildPDFReportDoc();
                doc.save(filename);
                showNotification("PDF Report generated successfully.", "success");
            } catch (err) {
                console.error("PDF Export Error:", err);
                showNotification("An error occurred during PDF generation.", "error");
            } finally {
                UI.btnDownloadPDF.innerHTML = originalBtnHTML;
                UI.btnDownloadPDF.disabled = false;
            }
        }

        /**
         * Saves high-res PNG screenshots of all active charts, the PDF report, a copy of the
         * input XYZ file, and the JSON configuration into a "<PartNum>_<SerialNum>" subfolder.
         * Remembers the last selected parent folder across sessions, with a "Change" option.
         * Falls back to downloading a ZIP archive if the File System Access API is unavailable.
         */
        async function saveAllToFolder(forcePick = false) {
            if (!State.rawPoints || State.rawPoints.length === 0) {
                showNotification("Please load and process data first.", "error");
                return;
            }
            if (!window.jspdf) {
                showNotification("PDF library is still loading. Please try again in a moment.", "error");
                return;
            }

            const rawPart = UI.inpPartNum.value.trim();
            const rawSerial = UI.inpSerialNum.value.trim();
            const safePart = sanitizeFilenamePart(rawPart);
            const safeSerial = sanitizeFilenamePart(rawSerial);

            let folderName = [safePart, safeSerial].filter(Boolean).join('_');
            if (!folderName) {
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                folderName = `Aperture_Report_${stamp}`;
            }

            let dirHandle = null;
            let useZipFallback = false;

            if (typeof window.showDirectoryPicker === 'function') {
                if (!forcePick && State.lastDirHandle) {
                    const hasPerm = await verifyDirPermission(State.lastDirHandle);
                    if (hasPerm) dirHandle = State.lastDirHandle;
                }

                if (!dirHandle) {
                    try {
                        const pickerOpts = { mode: 'readwrite' };
                        if (State.lastDirHandle) pickerOpts.startIn = State.lastDirHandle;
                        try {
                            dirHandle = await window.showDirectoryPicker(pickerOpts);
                        } catch (startInErr) {
                            if (startInErr && startInErr.name === 'AbortError') return;
                            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                        }
                        if (dirHandle) {
                            await saveLastDirHandle(dirHandle);
                        }
                    } catch (err) {
                        if (err && err.name === 'AbortError') return;
                        console.warn("Directory picker unavailable in this context, falling back to ZIP:", err);
                        useZipFallback = true;
                    }
                }
            } else {
                useZipFallback = true;
            }

            const originalBtnHTML = UI.btnExportToFolder.innerHTML;
            UI.btnExportToFolder.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Files...';
            UI.btnExportToFolder.disabled = true;

            try {
                // 1. Build PDF report
                const { doc, filename: pdfFilename } = await buildPDFReportDoc();
                const pdfBlob = doc.output('blob');

                // 2. Build configuration JSON copy
                const prefix = [safePart, safeSerial].filter(Boolean).join('_');
                const filePrefix = prefix ? `${prefix}_` : '';
                const configFilename = `${filePrefix}ATA_Settings.json`;
                const configBlob = new Blob([JSON.stringify(buildSettingsObject(), null, 2)], { type: 'application/json' });

                // 3. Build input XYZ file copy
                let inputFilename = null;
                let inputBlob = null;
                if (State.sourceFileText) {
                    const rawInputName = State.sourceFileName || 'input_data.txt';
                    const dotIdx = rawInputName.lastIndexOf('.');
                    const ext = dotIdx > 0 ? rawInputName.slice(dotIdx) : '.txt';
                    const base = dotIdx > 0 ? rawInputName.slice(0, dotIdx) : rawInputName;
                    inputFilename = `${sanitizeFilenamePart(base) || 'input_data'}${ext}`;
                    inputBlob = new Blob([State.sourceFileText], { type: 'text/plain;charset=utf-8' });
                }

                // 4. Capture PNG screenshots of all active charts
                const plotsToExport = getExportablePlots(180);
                const chartFiles = [];
                const usedNames = new Set([pdfFilename.toLowerCase(), configFilename.toLowerCase()]);
                if (inputFilename) usedNames.add(inputFilename.toLowerCase());

                for (const p of plotsToExport) {
                    const plotEl = document.getElementById(p.id);
                    if (!plotEl || !plotEl.layout) continue;

                    const pxW = p.id === 'plotOverview' ? 1600 : 1800;
                    const pxH = p.id === 'plotOverview' ? 1200 : 600;
                    const payload = buildExportChartPayload(plotEl, p.id, p.title);
                    const pngDataUrl = await Plotly.toImage(payload, {
                        format: 'png',
                        width: pxW,
                        height: pxH
                    });
                    const pngBlob = dataUrlToBlob(pngDataUrl);

                    const baseTitle = sanitizeFilenamePart(p.title) || p.id;
                    let pngName = `${filePrefix}${baseTitle}.png`;
                    let dup = 2;
                    while (usedNames.has(pngName.toLowerCase())) {
                        pngName = `${filePrefix}${baseTitle}_${dup++}.png`;
                    }
                    usedNames.add(pngName.toLowerCase());
                    chartFiles.push({ name: pngName, blob: pngBlob });
                }

                // 5. Write files to the selected folder's subfolder, or package into a ZIP fallback
                if (!useZipFallback && dirHandle) {
                    const subDirHandle = await dirHandle.getDirectoryHandle(folderName, { create: true });

                    const writeBlobToDir = async (targetDir, fileName, blob) => {
                        const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                    };

                    await writeBlobToDir(subDirHandle, pdfFilename, pdfBlob);
                    await writeBlobToDir(subDirHandle, configFilename, configBlob);
                    if (inputBlob && inputFilename) {
                        await writeBlobToDir(subDirHandle, inputFilename, inputBlob);
                    }
                    for (const cf of chartFiles) {
                        await writeBlobToDir(subDirHandle, cf.name, cf.blob);
                    }

                    showNotification(`Saved ${chartFiles.length} PNGs, PDF, config & input file into "${dirHandle.name}/${folderName}/".`, "success");
                } else {
                    if (!window.JSZip) {
                        showNotification("Folder access is unsupported in this browser and ZIP fallback failed to load.", "error");
                        return;
                    }
                    const zip = new JSZip();
                    const subFolder = zip.folder(folderName);
                    subFolder.file(pdfFilename, pdfBlob);
                    subFolder.file(configFilename, configBlob);
                    if (inputBlob && inputFilename) {
                        subFolder.file(inputFilename, inputBlob);
                    }
                    for (const cf of chartFiles) {
                        subFolder.file(cf.name, cf.blob);
                    }
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(zipBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${folderName}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);

                    showNotification(`Browser blocked direct folder write; downloaded "${folderName}.zip" (${chartFiles.length} PNGs, PDF, config & input).`, "info");
                }
            } catch (err) {
                console.error("Folder Export Error:", err);
                showNotification("An error occurred while saving files to the folder.", "error");
            } finally {
                UI.btnExportToFolder.innerHTML = originalBtnHTML;
                UI.btnExportToFolder.disabled = false;
            }
        }

        /* =========================================================================
         * Event Listeners & Debounced ResizeObserver
         * ========================================================================= */
        UI.fileInput.addEventListener('change', handleFileUpload);
        UI.btnLoadSample.addEventListener('click', generateSampleData);
        UI.btnProcess.addEventListener('click', applyModificationsAndProcess);
        UI.btnToggleSidebar.addEventListener('click', toggleSidebar);
        UI.selLayoutMode.addEventListener('change', updateLayoutMode);
        UI.selDimMode.addEventListener('change', toggleDimMode);
        UI.btnAddDimension.addEventListener('click', addDimensionChart);
        UI.btnEqualAxes.addEventListener('click', toggleEqualAxes);
        UI.btnDownloadPDF.addEventListener('click', downloadPDFReport);
        UI.btnExportToFolder.addEventListener('click', () => saveAllToFolder(false));
        if (UI.btnChangeExportFolder) {
            UI.btnChangeExportFolder.addEventListener('click', changeExportFolder);
        }
        UI.inpLogoUpload.addEventListener('change', handleLogoUpload);
        UI.btnRemoveLogo.addEventListener('click', removeLogo);

        UI.inpCompanyName.addEventListener('input', (e) => {
            const companyName = e.target.value.trim() || "AF ENGINEERING TOOLS";
            if (UI.sidebarCompanyText) UI.sidebarCompanyText.textContent = companyName.toUpperCase();
            document.title = `Aperture Tolerance Analyzer - ${companyName}`;
        });

        document.addEventListener('click', (e) => {
            const btn = document.getElementById('btnFailFilter');
            const dp = document.getElementById('dropdownFailFilter');
            if (btn && dp) {
                if (btn.contains(e.target)) {
                    dp.classList.toggle('hidden');
                } else if (!dp.contains(e.target) && !e.target.closest('#dropdownFailFilter')) {
                    dp.classList.add('hidden');
                }
            }
        });

        const resizeAllPlots = debounce(() => {
            if (UI.cardOverview.classList.contains('hidden')) return;
            const plots = ['plotOverview', 'plotStepX', 'plotStepY', 'plotAngle', 'plotBBX', 'plotBBY'];
            plots.forEach(id => {
                const el = document.getElementById(id);
                if (el && el.layout && !State.hiddenCharts.has(id)) {
                    Plotly.Plots.resize(id);
                }
            });
            document.querySelectorAll('[id^="dimChart_"]').forEach(chart => {
                if (chart.layout) Plotly.Plots.resize(chart.id);
            });
        }, 80);

        const resizeObserver = new ResizeObserver(() => resizeAllPlots());
        resizeObserver.observe(document.getElementById('mainContainer'));
        if (document.getElementById('cardOverview')) {
            resizeObserver.observe(document.getElementById('cardOverview'));
        }

        document.addEventListener('DOMContentLoaded', () => {
            updateLayoutMode();
            updateAllChartsTheme();
            loadLastDirHandle();
        });