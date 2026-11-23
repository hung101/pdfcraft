// PDFCraft App Controller

// Configure PDF.js Worker
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker-3.4.120.min.js';
}

// Global Application State
const state = {
    currentTab: 'merge',
    merge: {
        files: [] // Array of { id, file, name, totalPages, previewDataUrl }
    },
    split: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        selectedPages: new Set() // Selected page indexes (1-based)
    },
    edit: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        currentPageNum: 1,
        zoomMultiplier: 1.0,
        // Pages overlays: pageNum => array of overlays: { id, type, x, y, width, height, value }
        overlays: {},
        drawings: {}, // pageNum => transparent PNG data URL of drawings
        activeTool: null // 'pen', 'highlighter', or null
    },
    editText: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        currentPageNum: 1,
        // pageNum => [{ id, x, y, width, fontSize, original, replacement }]
        edits: {},
        // clickable text on the rendered page: pdf.js items grouped so each
        // covers whole content-stream operators (see PDFTools.groupTextItems)
        items: [],
        // the ungrouped pdf.js items, for the engine's same-line safety check
        rawItems: [],
        // the same bytes parsed by pdf-lib, to find operator starts per page
        libDoc: null,
        runCache: {},
        viewport: null,
        resultBlob: null,
        warnings: []
    },
    rotate: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        rotations: {} // pageIndex (0-based) => added rotation (90, 180, 270)
    },
    delete: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        deletedPages: new Set() // 0-based page indexes marked for deletion
    },
    imagesToPdf: {
        files: [] // Array of { id, file, name, size, type, src, width, height, convertedArrayBuffer, convertedType }
    },
    compress: {
        file: null,
        originalSize: 0,
        compressedBlob: null
    },
    reorder: {
        file: null,
        pdfDoc: null,
        totalPages: 0,
        order: [] // Array of 0-based page indexes in their active sequence
    },
    pdfToImages: {
        file: null,
        totalPages: 0,
        zipBlob: null
    },
    protect: {
        file: null,
        protectedBlob: null
    },
    unlock: {
        file: null,
        unlockedBlob: null,
        // the file has an empty open password: only permission flags to remove
        opensWithoutPassword: false
    },
    number: {
        file: null,
        numberedBlob: null
    },
    watermark: {
        file: null,
        watermarkedBlob: null
    }
};

// Signature Pad State
const signaturePad = {
    canvas: null,
    ctx: null,
    isDrawing: false,
    color: '#000000',
    lineWidth: 3,
    lastX: 0,
    lastY: 0
};

// Redefine window.alert to show a premium custom modal
window.alert = function(message) {
    showCustomAlert('Notification', message);
};

function showCustomAlert(title, message) {
    let modal = document.getElementById('custom-alert-modal');
    if (!modal) {
        // Create modal container
        modal = document.createElement('div');
        modal.id = 'custom-alert-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '9999'; // Ensure it floats above everything
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; text-align: center; padding: 2.25rem 1.75rem;">
                <div class="modal-header" style="border-bottom: none; padding-bottom: 0; justify-content: center; padding-top: 0;">
                    <div style="background: var(--danger-tint); width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 1.25rem; border: 1px solid var(--danger);" id="custom-alert-icon-wrapper">
                        <i data-lucide="alert-triangle" style="width: 30px; height: 30px; color: var(--danger);"></i>
                    </div>
                </div>
                <h3 id="custom-alert-title" style="font-family: var(--font-heading); font-weight: 700; font-size: 1.35rem; color: var(--text-main); margin-bottom: 0.5rem; letter-spacing: -0.02em;"></h3>
                <p id="custom-alert-message" style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.75rem; word-break: break-word; padding: 0 0.5rem;"></p>
                <div class="modal-footer" style="border-top: none; padding-top: 0; justify-content: center; padding-bottom: 0; width: 100%;">
                    <button class="btn btn-primary" id="custom-alert-ok-btn" style="width: 100%; justify-content: center; font-weight: 600; padding: 0.75rem 1.5rem;">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Click listeners
        const closeAlert = () => {
            modal.classList.remove('active');
        };

        modal.querySelector('#custom-alert-ok-btn').addEventListener('click', closeAlert);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAlert();
        });
    }

    // Always set as text: messages can carry file names, which are
    // user-controlled, so they must never reach innerHTML.
    document.getElementById('custom-alert-title').innerText = title;
    document.getElementById('custom-alert-message').innerText = message;

    // Adapt icon/style based on keywords in message (e.g. error, success, info)
    const iconWrapper = document.getElementById('custom-alert-icon-wrapper');
    const lowerMsg = message.toLowerCase();
    const isError = lowerMsg.includes('error') || lowerMsg.includes('failed') || lowerMsg.includes('could not') || lowerMsg.includes('invalid') || lowerMsg.includes('cannot') || lowerMsg.includes('please enter') || lowerMsg.includes('do not match');
    
    if (isError) {
        iconWrapper.style.background = 'var(--danger-tint)';
        iconWrapper.style.borderColor = 'var(--danger)';
        iconWrapper.innerHTML = '<i data-lucide="alert-circle" style="width: 30px; height: 30px; color: var(--danger);"></i>';
    } else if (lowerMsg.includes('success') || lowerMsg.includes('completed') || lowerMsg.includes('done')) {
        iconWrapper.style.background = 'var(--success-tint)';
        iconWrapper.style.borderColor = 'var(--success)';
        iconWrapper.innerHTML = '<i data-lucide="check-circle" style="width: 30px; height: 30px; color: var(--success);"></i>';
    } else {
        iconWrapper.style.background = 'var(--accent-glow)';
        iconWrapper.style.borderColor = 'var(--border-focus)';
        iconWrapper.innerHTML = '<i data-lucide="info" style="width: 30px; height: 30px; color: var(--accent-primary);"></i>';
    }

    // Recreate Lucide icon inside custom modal
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Force a reflow to trigger CSS transition
    modal.offsetHeight;

    // Show modal
    modal.classList.add('active');
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initTheme();
    initDropZones();
    initMergeWorkspace();
    initSplitWorkspace();
    initEditWorkspace();
    initRotateWorkspace();
    initDeleteWorkspace();
    initImagesToPdfWorkspace();
    initCompressWorkspace();
    initReorderWorkspace();
    initPdfToImagesWorkspace();
    initProtectWorkspace();
    initUnlockWorkspace();
    initNumberWorkspace();
    initWatermarkWorkspace();
    initEditTextWorkspace();
    initSignaturePad();
    initPWA();
    initMobileMenu();
    initMobileQuickNav();
    initWorkspaceObserver();
    relocatePrivacyBox();
    initPwaSponsorCheck();
    
    // Render initial icons
    lucide.createIcons();
});

// Loading Screen Helper
function showLoading(text) {
    document.getElementById('loading-text').innerText = text;
    document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

// Tab Management
function initTabs() {
    const activeNav = document.querySelector('.nav-btn.active');
    if (activeNav) {
        state.currentTab = activeNav.getAttribute('data-tab');
    }
}

// Dark/Light Theme Handler
function initTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return; // pages without the toggle must not abort the whole init chain
    const body = document.body;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

    // A saved choice is applied by the inline script at the top of <body>;
    // without one the page follows the system setting.
    const currentTheme = () => {
        if (body.classList.contains('dark-theme')) return 'dark';
        if (body.classList.contains('light-theme')) return 'light';
        return systemDark.matches ? 'dark' : 'light';
    };

    updateThemeIcon(currentTheme());
    systemDark.addEventListener('change', () => updateThemeIcon(currentTheme()));

    themeBtn.addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        body.classList.remove('light-theme', 'dark-theme');
        body.classList.add(next + '-theme');
        try { localStorage.setItem('theme', next); } catch (e) {}
        updateThemeIcon(next);
    });
}

function updateThemeIcon(theme) {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    if (theme === 'light') {
        themeBtn.innerHTML = '<i data-lucide="moon"></i>';
    } else {
        themeBtn.innerHTML = '<i data-lucide="sun"></i>';
    }
    lucide.createIcons({ attrs: { class: 'icon-theme' } });
}

// Mobile Menu Navigation Setup
function initMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // Check if toggle button already exists
    if (sidebar.querySelector('.menu-toggle')) return;

    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'menu-toggle';
    toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
    toggleBtn.setAttribute('aria-label', 'Toggle navigation menu');

    // Find logo area
    const logoArea = sidebar.querySelector('.logo-area');
    if (logoArea) {
        const mediaQuery = window.matchMedia('(max-width: 768px)');
        
        function handleViewportChange(e) {
            const themeToggle = document.getElementById('theme-toggle');
            const headerActions = document.querySelector('.workspace-header .header-actions');
            let logoActions = logoArea.querySelector('.logo-actions');

            if (e.matches) {
                // Mobile viewport
                if (!logoActions) {
                    logoActions = document.createElement('div');
                    logoActions.className = 'logo-actions';
                    logoArea.appendChild(logoActions);
                }
                
                if (themeToggle && !logoActions.contains(themeToggle)) {
                    logoActions.appendChild(themeToggle);
                }
                
                if (!logoActions.contains(toggleBtn)) {
                    logoActions.appendChild(toggleBtn);
                }
            } else {
                // Desktop viewport
                if (headerActions && themeToggle && !headerActions.contains(themeToggle)) {
                    headerActions.appendChild(themeToggle);
                }
                
                if (!logoArea.contains(toggleBtn)) {
                    logoArea.appendChild(toggleBtn);
                }
                
                if (logoActions) {
                    logoActions.remove();
                }
            }
        }

        // Register listener
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleViewportChange);
        } else {
            // Deprecated addListener fallback
            mediaQuery.addListener(handleViewportChange);
        }
        
        // Run once initially
        handleViewportChange(mediaQuery);
    }

    // Toggle menu-open class
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('menu-open');
        
        // Update icon
        if (sidebar.classList.contains('menu-open')) {
            toggleBtn.innerHTML = '<i data-lucide="x"></i>';
        } else {
            toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
        }
        lucide.createIcons();
    });

    // Close menu when clicking nav buttons
    const navBtns = sidebar.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sidebar.classList.remove('menu-open');
            toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
            lucide.createIcons();
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('menu-open') && !sidebar.contains(e.target)) {
            sidebar.classList.remove('menu-open');
            toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
            lucide.createIcons();
        }
    });
}

// Mobile Horizontally Scrolling Quick Navigation
function initMobileQuickNav() {
    const workspace = document.querySelector('.workspace');
    const header = document.querySelector('.workspace-header');
    if (!workspace || !header) return;

    // Do not show quick nav on the dashboard landing page
    if (document.getElementById('tab-dashboard')) return;

    if (document.querySelector('.mobile-quick-nav')) return;

    const quickNav = document.createElement('div');
    quickNav.className = 'mobile-quick-nav';
    
    const activeSidebarNav = document.querySelector('.sidebar .nav-btn.active');
    const currentTab = activeSidebarNav ? activeSidebarNav.getAttribute('data-tab') : 'merge';

    const tools = [
        { name: 'Merge', tab: 'merge', icon: 'merge', url: '/' },
        { name: 'Split', tab: 'split', icon: 'scissors', url: '/split-pdf' },
        { name: 'Edit', tab: 'edit', icon: 'pen-tool', url: '/sign-pdf' },
        { name: 'Rotate', tab: 'rotate', icon: 'rotate-cw', url: '/rotate-pdf' },
        { name: 'Delete', tab: 'delete', icon: 'trash-2', url: '/delete-pages' },
        { name: 'Reorder', tab: 'reorder', icon: 'move', url: '/reorder-pdf' },
        { name: 'To PDF', tab: 'images-to-pdf', icon: 'image', url: '/images-to-pdf' },
        { name: 'Compress', tab: 'compress', icon: 'minimize-2', url: '/compress-pdf' },
        { name: 'To Images', tab: 'pdf-to-images', icon: 'file-image', url: '/pdf-to-images' },
        { name: 'Protect', tab: 'protect', icon: 'lock', url: '/protect-pdf' },
        { name: 'Unlock', tab: 'unlock', icon: 'unlock', url: '/unlock-pdf' },
        { name: 'Number', tab: 'number', icon: 'binary', url: '/number-pdf' },
        { name: 'Watermark', tab: 'watermark', icon: 'stamp', url: '/watermark-pdf' },
        { name: 'Edit Text', tab: 'edit-text', icon: 'type', url: '/edit-pdf-text' }
    ];

    quickNav.innerHTML = tools.map(t => {
        const isActive = t.tab === currentTab ? 'active' : '';
        return `
            <a href="${t.url}" class="mobile-quick-nav-item ${isActive}" data-tab="${t.tab}">
                <i data-lucide="${t.icon}"></i>
                <span>${t.name}</span>
            </a>
        `;
    }).join('');

    header.insertAdjacentElement('afterend', quickNav);

    // Scroll active item into view
    const activeItem = quickNav.querySelector('.mobile-quick-nav-item.active');
    if (activeItem) {
        setTimeout(() => {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 100);
    }
}

// Automatically toggle body class 'workspace-active' when any workspace card is visible
function initWorkspaceObserver() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return;

    const updateWorkspaceActiveState = () => {
        const activeCards = Array.from(workspace.querySelectorAll('.workspace-card'))
            .filter(card => card.style.display !== 'none');
        
        if (activeCards.length > 0) {
            document.body.classList.add('workspace-active');
        } else {
            document.body.classList.remove('workspace-active');
        }
    };

    // Run once initially
    updateWorkspaceActiveState();

    // Observe style changes on workspace cards
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'style') {
                updateWorkspaceActiveState();
            }
        });
    });

    workspace.querySelectorAll('.workspace-card').forEach(card => {
        observer.observe(card, { attributes: true, attributeFilter: ['style'] });
    });
}

// Move privacy secure box from sidebar to workspace header dynamically
function relocatePrivacyBox() {
    const privacyBox = document.querySelector('.sidebar-footer .privacy-box');
    const headerActions = document.querySelector('.header-actions');
    
    if (privacyBox) {
        privacyBox.remove();
    }
    
    if (headerActions) {
        if (headerActions.querySelector('.privacy-badge')) return;
        
        const privacyBadge = document.createElement('div');
        privacyBadge.className = 'privacy-badge';
        privacyBadge.title = 'Your files are processed in this browser tab and never uploaded.';
        privacyBadge.innerHTML = `
            <i data-lucide="shield-check"></i>
            <span>Files stay on your device</span>
        `;
        
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle && headerActions.contains(themeToggle)) {
            headerActions.insertBefore(privacyBadge, themeToggle);
        } else {
            headerActions.appendChild(privacyBadge);
        }
    }
}

// Drag & Drop Setup
function initDropZones() {
    const dropZones = [
        { id: 'merge-drop-zone', inputId: 'merge-file-input', handler: handleMergeFiles, accept: 'pdf' },
        { id: 'split-drop-zone', inputId: 'split-file-input', handler: handleSplitFile, accept: 'pdf' },
        { id: 'edit-drop-zone', inputId: 'edit-file-input', handler: handleEditFile, accept: 'pdf' },
        { id: 'rotate-drop-zone', inputId: 'rotate-file-input', handler: handleRotateFile, accept: 'pdf' },
        { id: 'delete-drop-zone', inputId: 'delete-file-input', handler: handleDeleteFile, accept: 'pdf' },
        { id: 'images-to-pdf-drop-zone', inputId: 'images-to-pdf-file-input', handler: handleImagesToPdfFiles, accept: 'image' },
        { id: 'compress-drop-zone', inputId: 'compress-file-input', handler: handleCompressFile, accept: 'pdf' },
        { id: 'reorder-drop-zone', inputId: 'reorder-file-input', handler: handleReorderFile, accept: 'pdf' },
        { id: 'pdf-to-images-drop-zone', inputId: 'pdf-to-images-file-input', handler: handlePdfToImagesFile, accept: 'pdf' },
        { id: 'protect-drop-zone', inputId: 'protect-file-input', handler: handleProtectFile, accept: 'pdf' },
        { id: 'unlock-drop-zone', inputId: 'unlock-file-input', handler: handleUnlockFile, accept: 'pdf' },
        { id: 'number-drop-zone', inputId: 'number-file-input', handler: handleNumberFile, accept: 'pdf' },
        { id: 'watermark-drop-zone', inputId: 'watermark-file-input', handler: handleWatermarkFile, accept: 'pdf' },
        { id: 'edit-text-drop-zone', inputId: 'edit-text-file-input', handler: handleEditTextFile, accept: 'pdf' }
    ];

    dropZones.forEach(({ id, inputId, handler, accept }) => {
        const zone = document.getElementById(id);
        const input = document.getElementById(inputId);
        if (!zone || !input) return;

        // Click to browse
        zone.addEventListener('click', (e) => {
            if (e.target !== input) {
                input.click();
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handler(Array.from(e.target.files));
                input.value = ''; // Reset for re-uploads
            }
        });

        // Drag events
        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
            }, false);
        });

        zone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            let files;
            if (accept === 'image') {
                files = Array.from(dt.files).filter(f => f.type.startsWith('image/'));
            } else {
                files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            }
            
            if (files.length > 0) {
                handler(files);
            }
        });
    });
}

// Render PDF Page thumbnail wrapper helper
async function renderPageThumbnail(file, pageNum, canvasEl) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);
        
        const viewport = page.getViewport({ scale: 0.25 }); // scale down for thumb
        const context = canvasEl.getContext('2d');
        canvasEl.height = viewport.height;
        canvasEl.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (err) {
        console.error('Error rendering page thumbnail:', err);
    }
}

// Render PDF Page large preview helper
async function renderLargePreview(file, pageNum, canvasEl) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);
        
        // Render at scale 1.0 for a large crisp preview in the workspace
        const viewport = page.getViewport({ scale: 1.0 });
        const context = canvasEl.getContext('2d');
        canvasEl.height = viewport.height;
        canvasEl.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (err) {
        console.error('Error rendering large page preview:', err);
    }
}

// ----------------------------------------
// TOOL 1: MERGE PDF WORKSPACE LOGIC
// ----------------------------------------

function initMergeWorkspace() {
    const clearBtn = document.getElementById('merge-clear-btn');
    const addMoreBtn = document.getElementById('merge-add-more-btn');
    const addInput = document.getElementById('merge-add-input');
    const mergeActionBtn = document.getElementById('merge-action-btn');
    const workspace = document.getElementById('merge-workspace');

    if (!clearBtn || !addMoreBtn || !addInput || !mergeActionBtn || !workspace) return;

    clearBtn.addEventListener('click', () => {
        state.merge.files = [];
        updateMergeGrid();
    });

    addMoreBtn.addEventListener('click', () => addInput.click());
    addInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleMergeFiles(Array.from(e.target.files));
            addInput.value = '';
        }
    });

    // Accept file drops on the active workspace card itself
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleMergeFiles(files);
            }
        }
    });

    mergeActionBtn.addEventListener('click', async () => {
        if (state.merge.files.length < 2) {
            alert('Please select at least 2 PDF files to merge.');
            return;
        }

        showLoading('Merging PDFs and optimizing output...');
        try {
            const mergedBlob = await PDFTools.mergePDFs(state.merge.files.map(f => f.file));
            
            // Trigger download
            const url = URL.createObjectURL(mergedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'merged_document.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Merge error:', err);
            await alertPdfFailure(state.merge.files.map(f => f.file), 'An error occurred while merging your files. Ensure they are valid PDFs.');
        } finally {
            hideLoading();
        }
    });
}

async function handleMergeFiles(files) {
    showLoading('Loading PDF documents...');
    for (const file of files) {
        const id = 'merge-file-' + Date.now() + Math.random().toString(36).substr(2, 5);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            state.merge.files.push({
                id,
                file,
                name: file.name,
                totalPages: pdf.numPages
            });
        } catch (err) {
            console.error('Error reading PDF:', file.name, err);
        }
    }
    
    hideLoading();
    updateMergeGrid();
}

function updateMergeGrid() {
    const dropZone = document.getElementById('merge-drop-zone');
    const workspace = document.getElementById('merge-workspace');
    const grid = document.getElementById('merge-files-list');
    const countBadge = document.getElementById('merge-file-count');

    if (state.merge.files.length === 0) {
        dropZone.style.display = 'flex';
        workspace.style.display = 'none';
        return;
    }

    dropZone.style.display = 'none';
    workspace.style.display = 'flex';
    grid.innerHTML = '';
    
    countBadge.innerText = `${state.merge.files.length} File${state.merge.files.length > 1 ? 's' : ''} Selected`;

    state.merge.files.forEach((fileObj, idx) => {
        const tile = document.createElement('div');
        tile.className = 'file-tile';
        tile.setAttribute('draggable', 'true');
        tile.setAttribute('data-id', fileObj.id);
        
        tile.innerHTML = `
            <button class="tile-remove-btn" title="Remove File">
                <i data-lucide="x"></i>
            </button>
            <div class="tile-preview">
                <canvas id="canvas-${fileObj.id}"></canvas>
            </div>
            <div class="tile-title" title="${escapeHtmlText(fileObj.name)}">${escapeHtmlText(fileObj.name)}</div>
            <div class="tile-pages">${fileObj.totalPages} page${fileObj.totalPages > 1 ? 's' : ''}</div>
        `;
        
        // Remove button
        tile.querySelector('.tile-remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            state.merge.files.splice(idx, 1);
            updateMergeGrid();
        });

        // HTML5 drag and drop events for list sorting
        tile.addEventListener('dragstart', (e) => {
            tile.classList.add('file-tile-drag');
            e.dataTransfer.setData('text/plain', fileObj.id);
            e.dataTransfer.effectAllowed = 'move';
        });

        tile.addEventListener('dragend', () => {
            tile.classList.remove('file-tile-drag');
        });

        tile.addEventListener('dragover', (e) => {
            e.preventDefault();
            tile.classList.add('drag-over');
        });

        tile.addEventListener('dragleave', () => {
            tile.classList.remove('drag-over');
        });

        tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId !== fileObj.id) {
                const draggedIdx = state.merge.files.findIndex(f => f.id === draggedId);
                const targetIdx = state.merge.files.findIndex(f => f.id === fileObj.id);
                
                // Swap position
                const [draggedFile] = state.merge.files.splice(draggedIdx, 1);
                state.merge.files.splice(targetIdx, 0, draggedFile);
                updateMergeGrid();
            }
        });

        grid.appendChild(tile);
        
        // Render preview asynchronously
        const canvas = tile.querySelector('canvas');
        renderPageThumbnail(fileObj.file, 1, canvas);
    });

    lucide.createIcons();
}

// ----------------------------------------
// TOOL 2: SPLIT PDF WORKSPACE LOGIC
// ----------------------------------------

function initSplitWorkspace() {
    const resetBtn = document.getElementById('split-reset-btn');
    const selectAllBtn = document.getElementById('split-select-all-btn');
    const deselectAllBtn = document.getElementById('split-deselect-all-btn');
    const rangeInput = document.getElementById('split-ranges');
    const splitActionBtn = document.getElementById('split-action-btn');
    const methodRadios = document.getElementsByName('split-method');
    const rangeInputGroup = document.getElementById('range-input-group');
    const workspace = document.getElementById('split-workspace');

    if (!resetBtn || !selectAllBtn || !deselectAllBtn || !rangeInput || !splitActionBtn || !workspace) return;

    // Accept file drops on the split workspace card
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleSplitFile(files);
            }
        }
    });

    resetBtn.addEventListener('click', () => {
        state.split.file = null;
        state.split.pdfDoc = null;
        state.split.totalPages = 0;
        state.split.selectedPages.clear();
        
        document.getElementById('split-drop-zone').style.display = 'flex';
        document.getElementById('split-workspace').style.display = 'none';
    });

    selectAllBtn.addEventListener('click', () => {
        for (let i = 1; i <= state.split.totalPages; i++) {
            state.split.selectedPages.add(i);
        }
        updateSplitSelectionUI();
    });

    deselectAllBtn.addEventListener('click', () => {
        state.split.selectedPages.clear();
        updateSplitSelectionUI();
    });

    rangeInput.addEventListener('input', () => {
        parseRangesToSelection(rangeInput.value);
    });

    // Toggle range inputs based on radio buttons
    methodRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'all') {
                rangeInputGroup.style.display = 'none';
            } else {
                rangeInputGroup.style.display = 'flex';
            }
        });
    });

    splitActionBtn.addEventListener('click', async () => {
        if (!state.split.file) return;

        const splitMethod = document.querySelector('input[name="split-method"]:checked').value;
        
        if (splitMethod === 'range') {
            if (state.split.selectedPages.size === 0) {
                alert('Please select at least one page to extract.');
                return;
            }

            showLoading('Extracting pages...');
            try {
                const extractedBlob = await PDFTools.splitPDF(state.split.file, Array.from(state.split.selectedPages));
                
                const url = URL.createObjectURL(extractedBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `extracted_pages_${state.split.file.name}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error(err);
                await alertPdfFailure(state.split.file, 'Error extracting pages.');
            } finally {
                hideLoading();
            }
        } else {
            // Split every page
            showLoading(`Splitting into ${state.split.totalPages} separate documents...`);
            try {
                // To keep it simple and clean, download individual pages or bundle them. 
                // We will trigger individual downloads for up to 5 pages, or warn the user.
                if (state.split.totalPages > 10 && !confirm(`This will trigger ${state.split.totalPages} file downloads. Do you want to proceed?`)) {
                    hideLoading();
                    return;
                }
                
                for (let i = 1; i <= state.split.totalPages; i++) {
                    const extractedBlob = await PDFTools.splitPDF(state.split.file, [i]);
                    const url = URL.createObjectURL(extractedBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `page_${i}_of_${state.split.file.name}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
                    URL.revokeObjectURL(url);
                    // Add small delay to avoid browser choking on downloads
                    await new Promise(r => setTimeout(r, 150));
                }
            } catch (err) {
                console.error(err);
                await alertPdfFailure(state.split.file, 'Error splitting document.');
            } finally {
                hideLoading();
            }
        }
    });
}

async function handleSplitFile(files) {
    const file = files[0];
    state.split.file = file;
    state.split.selectedPages.clear();
    
    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.split.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.split.totalPages = state.split.pdfDoc.numPages;
        
        // Show workspace
        document.getElementById('split-drop-zone').style.display = 'none';
        document.getElementById('split-workspace').style.display = 'flex';
        document.getElementById('split-file-name').innerText = file.name;
        document.getElementById('split-total-pages').innerText = state.split.totalPages;
        
        // Set initial range to page 1
        document.getElementById('split-ranges').value = '1';
        state.split.selectedPages.add(1);

        // Render page list
        renderSplitPagesList();
        updateSplitSelectionUI();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

function renderSplitPagesList() {
    const grid = document.getElementById('split-pages-list');
    grid.innerHTML = '';

    for (let pageNum = 1; pageNum <= state.split.totalPages; pageNum++) {
        const tile = document.createElement('div');
        tile.className = 'page-tile';
        tile.setAttribute('data-page', pageNum);
        
        tile.innerHTML = `
            <div class="page-checkbox"></div>
            <div class="page-preview">
                <canvas id="split-canvas-${pageNum}"></canvas>
            </div>
            <div class="page-number">Page ${pageNum}</div>
        `;

        tile.addEventListener('click', () => {
            if (state.split.selectedPages.has(pageNum)) {
                state.split.selectedPages.delete(pageNum);
            } else {
                state.split.selectedPages.add(pageNum);
            }
            updateSplitSelectionUI(true); // update text input as well
        });

        grid.appendChild(tile);

        // Render preview
        const canvas = tile.querySelector('canvas');
        renderPageThumbnail(state.split.file, pageNum, canvas);
    }
}

function updateSplitSelectionUI(updateInput = false) {
    const tiles = document.querySelectorAll('.page-tile');
    tiles.forEach(tile => {
        const pageNum = parseInt(tile.getAttribute('data-page'));
        if (state.split.selectedPages.has(pageNum)) {
            tile.classList.add('selected');
        } else {
            tile.classList.remove('selected');
        }
    });

    document.getElementById('split-selected-count').innerText = state.split.selectedPages.size;

    // Update text range if user clicked page tiles
    if (updateInput) {
        const sortedSelected = Array.from(state.split.selectedPages).sort((a,b) => a-b);
        const ranges = [];
        if (sortedSelected.length > 0) {
            let start = sortedSelected[0];
            let end = start;
            
            for (let i = 1; i < sortedSelected.length; i++) {
                if (sortedSelected[i] === end + 1) {
                    end = sortedSelected[i];
                } else {
                    ranges.push(start === end ? `${start}` : `${start}-${end}`);
                    start = sortedSelected[i];
                    end = start;
                }
            }
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
        }
        document.getElementById('split-ranges').value = ranges.join(', ');
    }
}

function parseRangesToSelection(rangeStr) {
    state.split.selectedPages.clear();
    const parts = rangeStr.split(',');
    
    parts.forEach(part => {
        const range = part.trim();
        if (/^\d+$/.test(range)) {
            const num = parseInt(range);
            if (num >= 1 && num <= state.split.totalPages) {
                state.split.selectedPages.add(num);
            }
        } else if (/^\d+\s*-\s*\d+$/.test(range)) {
            const [startStr, endStr] = range.split('-');
            const start = parseInt(startStr.trim());
            const end = parseInt(endStr.trim());
            if (start <= end) {
                for (let i = Math.max(1, start); i <= Math.min(state.split.totalPages, end); i++) {
                    state.split.selectedPages.add(i);
                }
            }
        }
    });

    updateSplitSelectionUI(false); // don't loop update the input
}

// ----------------------------------------
// TOOL: ROTATE PDF WORKSPACE LOGIC
// ----------------------------------------

function initRotateWorkspace() {
    const resetBtn = document.getElementById('rotate-reset-btn');
    const rotateActionBtn = document.getElementById('rotate-action-btn');
    const workspace = document.getElementById('rotate-workspace');
    if (!resetBtn || !rotateActionBtn || !workspace) return;

    // Drag and drop on workspace
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleRotateFile(files);
            }
        }
    });

    resetBtn.addEventListener('click', () => {
        state.rotate.file = null;
        state.rotate.pdfDoc = null;
        state.rotate.totalPages = 0;
        state.rotate.rotations = {};

        document.getElementById('rotate-drop-zone').style.display = 'flex';
        document.getElementById('rotate-workspace').style.display = 'none';
    });

    rotateActionBtn.addEventListener('click', async () => {
        if (!state.rotate.file) return;

        showLoading('Rotating PDF pages...');
        try {
            const rotatedBlob = await PDFTools.rotatePDFPages(state.rotate.file, state.rotate.rotations);
            
            const url = URL.createObjectURL(rotatedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rotated_${state.rotate.file.name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            await alertPdfFailure(state.rotate.file, 'Error rotating PDF pages.');
        } finally {
            hideLoading();
        }
    });
}

async function handleRotateFile(files) {
    const file = files[0];
    state.rotate.file = file;
    state.rotate.rotations = {};

    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.rotate.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.rotate.totalPages = state.rotate.pdfDoc.numPages;

        // Show workspace
        document.getElementById('rotate-drop-zone').style.display = 'none';
        document.getElementById('rotate-workspace').style.display = 'flex';
        document.getElementById('rotate-file-name').innerText = file.name;
        document.getElementById('rotate-total-pages').innerText = state.rotate.totalPages;

        renderRotatePagesList();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

function renderRotatePagesList() {
    const grid = document.getElementById('rotate-pages-list');
    if (!grid) return;
    grid.innerHTML = '';

    for (let pageNum = 1; pageNum <= state.rotate.totalPages; pageNum++) {
        const pageIdx = pageNum - 1;
        const tile = document.createElement('div');
        tile.className = 'page-tile';
        tile.setAttribute('data-page-index', pageIdx);
        
        tile.innerHTML = `
            <button class="tile-action-btn rotate-btn" title="Rotate 90° Clockwise">
                <i data-lucide="rotate-cw" style="width: 14px; height: 14px;"></i>
            </button>
            <div class="page-preview">
                <canvas id="rotate-canvas-${pageNum}" style="transition: transform 0.2s ease;"></canvas>
            </div>
            <div class="page-number">Page ${pageNum}</div>
        `;

        const rotateBtn = tile.querySelector('.rotate-btn');
        const canvas = tile.querySelector('canvas');

        rotateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentRotation = state.rotate.rotations[pageIdx] || 0;
            const newRotation = (currentRotation + 90) % 360;
            state.rotate.rotations[pageIdx] = newRotation;
            
            // Apply CSS rotation transform visually
            canvas.style.transform = `rotate(${newRotation}deg)`;
        });

        grid.appendChild(tile);

        // Render preview
        renderPageThumbnail(state.rotate.file, pageNum, canvas);
    }
    lucide.createIcons();
}

// ----------------------------------------
// TOOL: DELETE PDF PAGES WORKSPACE LOGIC
// ----------------------------------------

function initDeleteWorkspace() {
    const resetBtn = document.getElementById('delete-reset-btn');
    const deleteActionBtn = document.getElementById('delete-action-btn');
    const workspace = document.getElementById('delete-workspace');
    if (!resetBtn || !deleteActionBtn || !workspace) return;

    // Drag and drop on workspace
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleDeleteFile(files);
            }
        }
    });

    resetBtn.addEventListener('click', () => {
        state.delete.file = null;
        state.delete.pdfDoc = null;
        state.delete.totalPages = 0;
        state.delete.deletedPages.clear();

        document.getElementById('delete-drop-zone').style.display = 'flex';
        document.getElementById('delete-workspace').style.display = 'none';
    });

    deleteActionBtn.addEventListener('click', async () => {
        if (!state.delete.file) return;

        if (state.delete.deletedPages.size === 0) {
            alert('Please select at least one page to delete.');
            return;
        }

        if (state.delete.deletedPages.size === state.delete.totalPages) {
            alert('Cannot delete all pages of a PDF document.');
            return;
        }

        showLoading('Deleting selected pages...');
        try {
            const compiledBlob = await PDFTools.deletePDFPages(state.delete.file, Array.from(state.delete.deletedPages));
            
            const url = URL.createObjectURL(compiledBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `deleted_pages_${state.delete.file.name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            await alertPdfFailure(state.delete.file, 'Error deleting PDF pages.');
        } finally {
            hideLoading();
        }
    });
}

async function handleDeleteFile(files) {
    const file = files[0];
    state.delete.file = file;
    state.delete.deletedPages.clear();

    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.delete.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.delete.totalPages = state.delete.pdfDoc.numPages;

        // Show workspace
        document.getElementById('delete-drop-zone').style.display = 'none';
        document.getElementById('delete-workspace').style.display = 'flex';
        document.getElementById('delete-file-name').innerText = file.name;
        document.getElementById('delete-total-pages').innerText = state.delete.totalPages;

        renderDeletePagesList();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

function renderDeletePagesList() {
    const grid = document.getElementById('delete-pages-list');
    if (!grid) return;
    grid.innerHTML = '';

    for (let pageNum = 1; pageNum <= state.delete.totalPages; pageNum++) {
        const pageIdx = pageNum - 1;
        const tile = document.createElement('div');
        tile.className = 'page-tile';
        tile.setAttribute('data-page-index', pageIdx);
        
        tile.innerHTML = `
            <button class="tile-action-btn delete-btn" title="Delete Page">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
            <div class="page-preview">
                <canvas id="delete-canvas-${pageNum}"></canvas>
            </div>
            <div class="page-number">Page ${pageNum}</div>
        `;

        const deleteBtn = tile.querySelector('.delete-btn');

        tile.addEventListener('click', () => {
            togglePageDeletion(pageIdx, tile);
        });

        grid.appendChild(tile);

        // Render preview
        const canvas = tile.querySelector('canvas');
        renderPageThumbnail(state.delete.file, pageNum, canvas);
    }
    lucide.createIcons();
}

function togglePageDeletion(pageIdx, tileEl) {
    if (state.delete.deletedPages.has(pageIdx)) {
        state.delete.deletedPages.delete(pageIdx);
        tileEl.classList.remove('deleted');
        tileEl.querySelector('.delete-btn').setAttribute('title', 'Delete Page');
    } else {
        state.delete.deletedPages.add(pageIdx);
        tileEl.classList.add('deleted');
        tileEl.querySelector('.delete-btn').setAttribute('title', 'Restore Page');
    }
}

// ----------------------------------------
// TOOL 6: IMAGES TO PDF WORKSPACE LOGIC
// ----------------------------------------

function initImagesToPdfWorkspace() {
    const clearBtn = document.getElementById('images-to-pdf-clear-btn');
    const addMoreBtn = document.getElementById('images-to-pdf-add-more-btn');
    const addInput = document.getElementById('images-to-pdf-add-input');
    const convertActionBtn = document.getElementById('images-to-pdf-action-btn');
    const workspace = document.getElementById('images-to-pdf-workspace');
    if (!clearBtn || !addMoreBtn || !addInput || !convertActionBtn || !workspace) return;

    clearBtn.addEventListener('click', () => {
        state.imagesToPdf.files = [];
        updateImagesToPdfGrid();
    });

    addMoreBtn.addEventListener('click', () => addInput.click());
    addInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImagesToPdfFiles(Array.from(e.target.files));
            addInput.value = '';
        }
    });

    // Accept file drops on the active workspace card itself
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) {
                handleImagesToPdfFiles(files);
            }
        }
    });

    // Refresh preview layout when settings change
    const pageSizeSelect = document.getElementById('images-to-pdf-page-size');
    const orientationSelect = document.getElementById('images-to-pdf-orientation');
    const marginSelect = document.getElementById('images-to-pdf-margin');
    const alignmentSelect = document.getElementById('images-to-pdf-alignment');
    
    [pageSizeSelect, orientationSelect, marginSelect, alignmentSelect].forEach(select => {
        if (select) {
            select.addEventListener('change', () => {
                if (select === pageSizeSelect) {
                    if (pageSizeSelect.value === 'fit') {
                        orientationSelect.disabled = true;
                        orientationSelect.parentElement.style.opacity = '0.5';
                    } else {
                        orientationSelect.disabled = false;
                        orientationSelect.parentElement.style.opacity = '1';
                    }
                }
                updateImagesToPdfGrid();
            });
        }
    });

    convertActionBtn.addEventListener('click', async () => {
        if (state.imagesToPdf.files.length === 0) {
            alert('Please select at least one image file to convert.');
            return;
        }

        const pageSize = document.getElementById('images-to-pdf-page-size').value;
        const orientation = document.getElementById('images-to-pdf-orientation').value;
        const margin = document.getElementById('images-to-pdf-margin').value;
        const alignment = document.getElementById('images-to-pdf-alignment').value;

        showLoading('Converting images to PDF...');
        try {
            const pdfBlob = await PDFTools.convertImagesToPDF(state.imagesToPdf.files, {
                pageSize,
                orientation,
                margin,
                alignment
            });

            // Trigger download
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'converted_images.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Images to PDF conversion error:', err);
            alert('An error occurred during conversion: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

async function handleImagesToPdfFiles(files) {
    showLoading('Processing images...');
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    for (const file of imageFiles) {
        const id = 'img-file-' + Date.now() + Math.random().toString(36).substr(2, 5);
        try {
            await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const dataUrl = e.target.result;
                    const img = new Image();
                    img.onload = async () => {
                        let finalArrayBuffer = null;
                        let finalType = file.type;

                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        // If not raw JPEG or PNG, convert to JPEG for embedding compatibility with pdf-lib
                        if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/jpg') {
                            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
                            finalArrayBuffer = await blob.arrayBuffer();
                            finalType = 'image/jpeg';
                        }

                        state.imagesToPdf.files.push({
                            id,
                            file,
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            src: dataUrl,
                            width: img.width,
                            height: img.height,
                            convertedArrayBuffer: finalArrayBuffer,
                            convertedType: finalType
                        });
                        resolve();
                    };
                    img.onerror = () => {
                        console.error('Error loading image', file.name);
                        reject(new Error('Invalid image file.'));
                    };
                    img.src = dataUrl;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        } catch (err) {
            console.error('Error processing image:', file.name, err);
        }
    }

    hideLoading();
    updateImagesToPdfGrid();
}

function updateImagesToPdfGrid() {
    const dropZone = document.getElementById('images-to-pdf-drop-zone');
    const workspace = document.getElementById('images-to-pdf-workspace');
    const grid = document.getElementById('images-to-pdf-files-list');
    const countBadge = document.getElementById('images-to-pdf-file-count');

    if (!dropZone || !workspace || !grid) return;

    if (state.imagesToPdf.files.length === 0) {
        dropZone.style.display = 'flex';
        workspace.style.display = 'none';
        return;
    }

    dropZone.style.display = 'none';
    workspace.style.display = 'flex';
    grid.innerHTML = '';

    if (countBadge) {
        countBadge.innerText = `${state.imagesToPdf.files.length} Image${state.imagesToPdf.files.length > 1 ? 's' : ''} Selected`;
    }

    // Get current options to style previews dynamically
    const pageSizeSelect = document.getElementById('images-to-pdf-page-size');
    const orientationSelect = document.getElementById('images-to-pdf-orientation');
    const marginSelect = document.getElementById('images-to-pdf-margin');
    const alignmentSelect = document.getElementById('images-to-pdf-alignment');

    const pageSize = pageSizeSelect ? pageSizeSelect.value : 'a4';
    const orientation = orientationSelect ? orientationSelect.value : 'portrait';
    const margin = marginSelect ? marginSelect.value : 'none';
    const alignment = alignmentSelect ? alignmentSelect.value : 'center';

    // Calculate Padding representing Margins
    let paddingValue = '0px';
    if (margin === 'small') paddingValue = '6px';
    else if (margin === 'large') paddingValue = '15px';

    // Calculate Object Fit representing alignment options
    const objectFitValue = alignment === 'stretch' ? 'fill' : 'contain';

    state.imagesToPdf.files.forEach((fileObj, idx) => {
        // Calculate Aspect Ratio based on page size & orientation
        let aspectRatio = '1';
        if (pageSize === 'fit') {
            aspectRatio = `${fileObj.width}/${fileObj.height}`;
        } else if (pageSize === 'a4') {
            aspectRatio = orientation === 'landscape' ? '297/210' : '210/297';
        } else if (pageSize === 'letter') {
            aspectRatio = orientation === 'landscape' ? '11/8.5' : '8.5/11';
        }

        const tile = document.createElement('div');
        tile.className = 'file-tile';
        tile.setAttribute('draggable', 'true');
        tile.setAttribute('data-id', fileObj.id);

        tile.innerHTML = `
            <button class="tile-remove-btn" title="Remove Image">
                <i data-lucide="x"></i>
            </button>
            <div class="tile-preview" style="height: 150px; max-width: 100%; width: auto; aspect-ratio: ${aspectRatio}; padding: ${paddingValue}; background-color: var(--bg-card); display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box; border: 1px dashed var(--border-color); border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.15); transition: all 0.2s ease;">
                <img src="${fileObj.src}" alt="" style="width: 100%; height: 100%; object-fit: ${objectFitValue}; display: block; border-radius: 2px;" />
            </div>
            <div class="tile-title" title="${escapeHtmlText(fileObj.name)}">${escapeHtmlText(fileObj.name)}</div>
            <div class="tile-pages">${fileObj.width} × ${fileObj.height} px</div>
        `;

        // Remove button
        tile.querySelector('.tile-remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            state.imagesToPdf.files.splice(idx, 1);
            updateImagesToPdfGrid();
        });

        // HTML5 drag and drop events for list sorting
        tile.addEventListener('dragstart', (e) => {
            tile.classList.add('file-tile-drag');
            e.dataTransfer.setData('text/plain', fileObj.id);
            e.dataTransfer.effectAllowed = 'move';
        });

        tile.addEventListener('dragend', () => {
            tile.classList.remove('file-tile-drag');
        });

        tile.addEventListener('dragover', (e) => {
            e.preventDefault();
            tile.classList.add('drag-over');
        });

        tile.addEventListener('dragleave', () => {
            tile.classList.remove('drag-over');
        });

        tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId !== fileObj.id) {
                const draggedIdx = state.imagesToPdf.files.findIndex(f => f.id === draggedId);
                const targetIdx = state.imagesToPdf.files.findIndex(f => f.id === fileObj.id);

                // Swap position
                const [draggedFile] = state.imagesToPdf.files.splice(draggedIdx, 1);
                state.imagesToPdf.files.splice(targetIdx, 0, draggedFile);
                updateImagesToPdfGrid();
            }
        });

        grid.appendChild(tile);
    });

    lucide.createIcons();
}

// ----------------------------------------
// TOOL 3: SIGN & EDIT WORKSPACE LOGIC
// ----------------------------------------

function initEditWorkspace() {
    const resetBtn = document.getElementById('edit-reset-btn');
    const addTextBtn = document.getElementById('add-text-btn');
    const addSignBtn = document.getElementById('add-sign-btn');
    const addImageBtn = document.getElementById('add-image-btn');
    const addRedactBtn = document.getElementById('add-redact-btn');
    const drawPenBtn = document.getElementById('draw-pen-btn');
    const drawHighlighterBtn = document.getElementById('draw-highlighter-btn');
    const drawClearBtn = document.getElementById('draw-clear-btn');
    const editActionBtn = document.getElementById('edit-action-btn');
    const workspace = document.getElementById('edit-workspace');

    if (!resetBtn || !addTextBtn || !addSignBtn || !editActionBtn || !workspace) return;

    // Accept file drops on the edit workspace card
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleEditFile(files);
            }
        }
    });

    resetBtn.addEventListener('click', () => {
        state.edit.file = null;
        state.edit.pdfDoc = null;
        state.edit.totalPages = 0;
        state.edit.overlays = {};
        state.edit.drawings = {};
        state.edit.activeTool = null;
        
        document.getElementById('edit-drop-zone').style.display = 'flex';
        document.getElementById('edit-workspace').style.display = 'none';
        document.body.classList.remove('workspace-active');
        document.getElementById('canvas-workspace-wrapper').innerHTML = '';
        document.getElementById('editor-page-thumbnails').innerHTML = '';
        
        // Reset tool buttons active styling
        if (drawPenBtn) drawPenBtn.classList.remove('btn-tool-active');
        if (drawHighlighterBtn) drawHighlighterBtn.classList.remove('btn-tool-active');
        const drawControls = document.getElementById('drawing-controls');
        if (drawControls) drawControls.style.display = 'none';
    });

    addTextBtn.addEventListener('click', () => {
        if (!state.edit.file) return;
        deactivateDrawingTools();
        addOverlayElement({
            id: 'txt-' + Date.now(),
            type: 'text',
            x: 50,
            y: 50,
            width: 150,
            height: 30,
            value: 'Double click to edit text'
        });
    });

    addSignBtn.addEventListener('click', () => {
        if (!state.edit.file) return;
        deactivateDrawingTools();
        
        // Clear sign pad and open modal
        signaturePad.ctx.clearRect(0, 0, signaturePad.canvas.width, signaturePad.canvas.height);
        document.getElementById('signature-modal').classList.add('active');
    });

    // Add Image Button Handler
    const imageUpload = document.getElementById('image-upload-input');
    if (imageUpload) {
        imageUpload.addEventListener('change', (e) => {
            if (e.target.files.length === 0) return;
            deactivateDrawingTools();
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                addOverlayElement({
                    id: 'img-' + Date.now(),
                    type: 'image',
                    x: 60,
                    y: 60,
                    width: 120,
                    height: 120,
                    value: event.target.result
                });
            };
            reader.readAsDataURL(file);
            imageUpload.value = ''; // Reset input
        });
    }

    // Add Black Box Button Handler
    // NOTE: this draws a filled rectangle over the page. It does NOT remove the
    // underlying text from the content stream, so it is a visual cover, not
    // redaction. The warning below must stay visible while boxes are in use.
    if (addRedactBtn) {
        addRedactBtn.addEventListener('click', () => {
            if (!state.edit.file) return;
            deactivateDrawingTools();
            addOverlayElement({
                id: 'red-' + Date.now(),
                type: 'redaction',
                x: 50,
                y: 50,
                width: 120,
                height: 40,
                color: '#000000'
            });

            const redactWarning = document.getElementById('redaction-warning');
            if (redactWarning) {
                redactWarning.style.display = 'flex';
                if (window.lucide) lucide.createIcons();
            }
        });
    }

    // Freehand Pen Tool Handler
    if (drawPenBtn) {
        drawPenBtn.addEventListener('click', () => {
            if (!state.edit.file) return;
            toggleDrawingTool('pen', drawPenBtn);
        });
    }

    // Highlighter Tool Handler
    if (drawHighlighterBtn) {
        drawHighlighterBtn.addEventListener('click', () => {
            if (!state.edit.file) return;
            toggleDrawingTool('highlighter', drawHighlighterBtn);
        });
    }

    // Clear drawings button
    if (drawClearBtn) {
        drawClearBtn.addEventListener('click', () => {
            const drawCanvas = document.querySelector('.drawing-layer-canvas');
            if (drawCanvas) {
                const ctx = drawCanvas.getContext('2d');
                ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                saveDrawingLayer(drawCanvas);
            }
        });
    }

    // Toggle drawing tools state helper
    const toggleDrawingTool = (toolName, btnEl) => {
        const wrapper = document.getElementById('canvas-workspace-wrapper');
        if (!wrapper) return;
        
        // Remove active class from all drawing buttons
        if (drawPenBtn) drawPenBtn.classList.remove('btn-tool-active');
        if (drawHighlighterBtn) drawHighlighterBtn.classList.remove('btn-tool-active');
        
        const drawControls = document.getElementById('drawing-controls');
        
        if (state.edit.activeTool === toolName) {
            state.edit.activeTool = null;
            wrapper.classList.remove('drawing-active');
            if (drawControls) drawControls.style.display = 'none';
        } else {
            // Save current overlays
            saveCurrentOverlaysFromDOM();
            
            // Remove selection active styling from overlays
            document.querySelectorAll('.draggable-overlay').forEach(item => item.classList.remove('editing-active'));
            updateTextToolbar(null);
            
            state.edit.activeTool = toolName;
            btnEl.classList.add('btn-tool-active');
            wrapper.classList.add('drawing-active');
            if (drawControls) drawControls.style.display = 'flex';
        }
    };

    const deactivateDrawingTools = () => {
        state.edit.activeTool = null;
        const wrapper = document.getElementById('canvas-workspace-wrapper');
        if (wrapper) wrapper.classList.remove('drawing-active');
        if (drawPenBtn) drawPenBtn.classList.remove('btn-tool-active');
        if (drawHighlighterBtn) drawHighlighterBtn.classList.remove('btn-tool-active');
        const drawControls = document.getElementById('drawing-controls');
        if (drawControls) drawControls.style.display = 'none';
    };

    // Zoom event handlers
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    zoomInBtn.addEventListener('click', () => {
        if (!state.edit.file) return;
        if (state.edit.zoomMultiplier >= 2.5) return;
        
        saveCurrentOverlaysFromDOM();
        state.edit.zoomMultiplier += 0.15;
        loadEditorPage(state.edit.currentPageNum, true);
    });

    zoomOutBtn.addEventListener('click', () => {
        if (!state.edit.file) return;
        if (state.edit.zoomMultiplier <= 0.5) return;
        
        saveCurrentOverlaysFromDOM();
        state.edit.zoomMultiplier -= 0.15;
        loadEditorPage(state.edit.currentPageNum, true);
    });

    // Bind text overlay styling controls
    const familySelect = document.getElementById('font-family-select');
    const sizeSelect = document.getElementById('font-size-select');
    const colorPicker = document.getElementById('text-color-picker');

    const applyStyleToActiveElement = () => {
        const activeTextEl = document.querySelector('.draggable-overlay.editing-active.text-element');
        const activeRedactEl = document.querySelector('.draggable-overlay.editing-active.redaction-element');
        
        if (activeTextEl) {
            const fontFamily = familySelect.value;
            const fontSize = parseInt(sizeSelect.value) || 16;
            const color = colorPicker.value;
            
            activeTextEl.style.fontFamily = fontFamily === 'Times Roman' ? "'Times New Roman', Times, serif" :
                                        fontFamily === 'Courier' ? "'Courier New', Courier, monospace" :
                                        "Arial, Helvetica, sans-serif";
            activeTextEl.style.fontSize = `${fontSize}px`;
            activeTextEl.style.color = color;
            
            const input = activeTextEl.querySelector('input');
            if (input) {
                input.style.color = color;
            }
        } else if (activeRedactEl) {
            const color = colorPicker.value;
            activeRedactEl.style.backgroundColor = color;
        }

        saveCurrentOverlaysFromDOM();
    };

    [familySelect, sizeSelect, colorPicker].forEach(control => {
        if (control) {
            control.addEventListener('change', applyStyleToActiveElement);
            control.addEventListener('input', applyStyleToActiveElement);
        }
    });

    // Add deselect click handler on active page background
    const activeCanvasContainer = document.getElementById('editor-active-canvas-container');
    activeCanvasContainer.addEventListener('click', (e) => {
        if (e.target === activeCanvasContainer || e.target.id === 'editor-active-canvas') {
            document.querySelectorAll('.draggable-overlay').forEach(item => item.classList.remove('editing-active'));
            updateTextToolbar(null);
        }
    });

    editActionBtn.addEventListener('click', async () => {
        if (!state.edit.file) return;
        
        saveCurrentOverlaysFromDOM();
        
        // Deep copy overlays to prevent polluting visual overlays
        const finalOverlays = {};
        for (const [pageNum, list] of Object.entries(state.edit.overlays)) {
            finalOverlays[pageNum] = list.map(item => ({ ...item }));
        }

        // Merge drawings as transparent overlays
        if (state.edit.drawings) {
            for (const [pageNumStr, dataUrl] of Object.entries(state.edit.drawings)) {
                const pageNum = parseInt(pageNumStr);
                if (!finalOverlays[pageNum]) {
                    finalOverlays[pageNum] = [];
                }
                finalOverlays[pageNum].push({
                    id: 'drw-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    type: 'drawing',
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 100,
                    canvasWidth: 100,
                    canvasHeight: 100,
                    value: dataUrl
                });
            }
        }
        
        showLoading('Applying overlays and rebuilding PDF...');
        try {
            const compiledBlob = await PDFTools.addOverlaysToPDF(state.edit.file, finalOverlays);
            
            const url = URL.createObjectURL(compiledBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `edited_${state.edit.file.name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            await alertPdfFailure(state.edit.file, 'Error applying modifications to PDF.');
        } finally {
            hideLoading();
        }
    });
}

async function handleEditFile(files) {
    const file = files[0];
    state.edit.file = file;
    state.edit.overlays = {};
    state.edit.drawings = {};
    state.edit.activeTool = null;
    
    showLoading('Loading PDF Editor...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.edit.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.edit.totalPages = state.edit.pdfDoc.numPages;
        
        // Init empty arrays for page overlays
        for (let i = 1; i <= state.edit.totalPages; i++) {
            state.edit.overlays[i] = [];
        }

        // Display workspace
        document.getElementById('edit-drop-zone').style.display = 'none';
        document.getElementById('edit-workspace').style.display = 'flex';
        document.body.classList.add('workspace-active');
        document.getElementById('edit-file-name').innerText = file.name;
        
        // Render thumbnails and load first page
        renderEditorThumbnails();
        loadEditorPage(1);
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not open PDF file.');
    } finally {
        hideLoading();
    }
}

function renderEditorThumbnails() {
    const container = document.getElementById('editor-page-thumbnails');
    if (!container) return;

    if (state.edit.totalPages <= 1) {
        container.style.display = 'none';
        const editorLayout = document.querySelector('.editor-layout');
        if (editorLayout) editorLayout.style.gridTemplateColumns = '1fr';
        return;
    } else {
        container.style.display = 'flex';
        const editorLayout = document.querySelector('.editor-layout');
        if (editorLayout) editorLayout.style.gridTemplateColumns = '160px 1fr';
    }

    container.innerHTML = '';

    for (let pageNum = 1; pageNum <= state.edit.totalPages; pageNum++) {
        const thumb = document.createElement('div');
        thumb.className = `thumb-item ${pageNum === state.edit.currentPageNum ? 'active' : ''}`;
        thumb.setAttribute('data-page', pageNum);
        
        thumb.innerHTML = `
            <canvas id="edit-thumb-canvas-${pageNum}"></canvas>
            <span class="thumb-number">${pageNum}</span>
        `;

        thumb.addEventListener('click', () => {
            if (pageNum === state.edit.currentPageNum) return;
            // Save current page overlays visually first
            saveCurrentOverlaysFromDOM();
            
            // Toggle active thumbnail
            document.querySelectorAll('.thumb-item').forEach(el => el.classList.remove('active'));
            thumb.classList.add('active');
            
            // Load new page
            loadEditorPage(pageNum);
        });

        container.appendChild(thumb);
        
        const canvas = thumb.querySelector('canvas');
        renderPageThumbnail(state.edit.file, pageNum, canvas);
    }
}

/**
 * Sizes a page canvas for the screen's pixel density: the backing store gets
 * devicePixelRatio times the CSS size, so the page is not upscaled (blurry)
 * on Retina screens and phones. Layout and overlay maths keep using the CSS
 * size, which stays viewport.width x viewport.height.
 * @returns {number} the ratio to pass to page.render as a transform
 */
function sharpCanvas(canvas, viewport) {
    // iOS Safari refuses canvases above ~16.7M pixels; stay under that.
    const MAX_PIXELS = 16e6;
    const area = viewport.width * viewport.height;
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / area)));
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    return ratio;
}

async function loadEditorPage(pageNum, keepZoomMultiplier = false) {
    state.edit.currentPageNum = pageNum;
    if (!keepZoomMultiplier) {
        state.edit.zoomMultiplier = 1.0;
    }
    const workspaceWrapper = document.getElementById('canvas-workspace-wrapper');
    workspaceWrapper.innerHTML = ''; // Clear previous page
    
    showLoading(`Rendering Page ${pageNum}...`);
    try {
        const page = await state.edit.pdfDoc.getPage(pageNum);
        
        // Dynamically calculate scale to fit the workspace editor width
        const container = document.getElementById('editor-active-canvas-container');
        const paddingOffset = 48; // margins around the page
        const containerWidth = container.clientWidth - paddingOffset;
        
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        
        // Fit to width of editing pane for large, readable view (scrolling vertically if needed)
        let scale = containerWidth / unscaledViewport.width;
        
        // Clamp scale to a highly readable range (allow lower scale on mobile viewports to fit the screen width)
        const isMobile = window.innerWidth <= 768;
        const minScale = isMobile ? 0.3 : 0.85;
        scale = Math.min(Math.max(scale, minScale), 1.5);
        
        // Apply zoom multiplier
        const zoomedScale = scale * state.edit.zoomMultiplier;
        const viewport = page.getViewport({ scale: zoomedScale });
        
        const canvas = document.createElement('canvas');
        canvas.id = 'editor-active-canvas';
        const ratio = sharpCanvas(canvas, viewport);

        workspaceWrapper.style.width = `${viewport.width}px`;
        workspaceWrapper.style.height = `${viewport.height}px`;
        workspaceWrapper.appendChild(canvas);

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null
        };
        
        await page.render(renderContext).promise;
        
        // Initialize drawing layer
        initDrawingLayer(workspaceWrapper, viewport);
        
        // Update zoom badge in toolbar
        const badge = document.getElementById('zoom-level-badge');
        if (badge) {
            badge.innerText = `${Math.round(state.edit.zoomMultiplier * 100)}%`;
        }
        
        // Re-inject saved overlays for this page
        const pageOverlays = state.edit.overlays[pageNum] || [];
        pageOverlays.forEach(overlay => {
            renderOverlayElementOnDOM(overlay);
        });

    } catch (err) {
        console.error(err);
        alert('Could not render page in editor.');
    } finally {
        hideLoading();
    }
}

// Visual Element Overlays Builder
function renderOverlayElementOnDOM(data) {
    const wrapper = document.getElementById('canvas-workspace-wrapper');
    const newWidth = wrapper.offsetWidth;
    const newHeight = wrapper.offsetHeight;
    
    let scaleRatioX = 1;
    let scaleRatioY = 1;
    
    if (data.canvasWidth && data.canvasWidth !== newWidth) {
        scaleRatioX = newWidth / data.canvasWidth;
        scaleRatioY = newHeight / data.canvasHeight;
    }
    
    const elX = data.x * scaleRatioX;
    const elY = data.y * scaleRatioY;
    const elW = data.width * scaleRatioX;
    const elH = data.height * scaleRatioY;
    const elFontSize = (data.fontSize || 16) * scaleRatioY;

    const el = document.createElement('div');
    el.className = `draggable-overlay ${data.type}-element`;
    el.id = data.id;
    el.style.left = `${elX}px`;
    el.style.top = `${elY}px`;
    el.style.width = `${elW}px`;
    el.style.height = `${elH}px`;
    el.style.fontSize = `${elFontSize}px`;

    // Restore custom font styles
    if (data.type === 'text') {
        const fontFamily = data.fontFamily || 'Helvetica';
        el.style.fontFamily = fontFamily === 'Times Roman' ? "'Times New Roman', Times, serif" :
                             fontFamily === 'Courier' ? "'Courier New', Courier, monospace" :
                             "Arial, Helvetica, sans-serif";
        el.style.color = data.color || '#000000';
    }

    // Elements structure
    let contentHTML = '';
    if (data.type === 'text') {
        contentHTML = `<span class="text-content">${escapeHtmlText(data.value)}</span>`;   // typed text, not markup
    } else if (data.type === 'signature' || data.type === 'image') {
        contentHTML = `<img src="${data.value}" alt="overlay" draggable="false">`;
    } else if (data.type === 'redaction') {
        el.style.backgroundColor = data.color || '#000000';
        contentHTML = '';
    }

    el.innerHTML = `
        <div class="element-controls">
            <button class="control-btn delete-el-btn" title="Delete"><i data-lucide="trash"></i></button>
        </div>
        ${contentHTML}
        <div class="resize-handle"></div>
    `;

    // Make it draggable
    makeElementDraggable(el, wrapper);

    // Make it resizable
    makeElementResizable(el, wrapper);

    // Text specific double-click editing
    if (data.type === 'text') {
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            enterTextEditMode(el);
        });
    }

    // Delete handler
    el.querySelector('.delete-el-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        el.remove();
        saveCurrentOverlaysFromDOM();
    });

    wrapper.appendChild(el);
    lucide.createIcons();
}

function addOverlayElement(data) {
    renderOverlayElementOnDOM(data);
    saveCurrentOverlaysFromDOM();
    
    // Auto-focus and edit text elements immediately when created
    if (data.type === 'text') {
        const el = document.getElementById(data.id);
        if (el) {
            enterTextEditMode(el);
            updateTextToolbar(el);
        }
    }
}

// Drag & Drop Positioning inside active Canvas
function makeElementDraggable(el, parentEl) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    let activePointerId = null;
    
    // Pointer events rather than mouse events: the same code path then serves
    // touch and pen, so overlays can be positioned on a phone.
    el.addEventListener('pointerdown', dragMouseDown);

    function dragMouseDown(e) {
        // Primary pointer only; for a mouse that additionally means the left button.
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) ||
            e.target.closest('.element-controls') || e.target.closest('.resize-handle') || e.target.tagName === 'INPUT') {
            return;
        }
        
        e.preventDefault();
        // Remove editing-active class from all other elements
        document.querySelectorAll('.draggable-overlay').forEach(item => item.classList.remove('editing-active'));
        el.classList.add('editing-active');

        // Update font settings toolbar when active element changes
        updateTextToolbar(el);

        // Get mouse cursor position on startup
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        // Capture the pointer so the drag survives the cursor leaving the element.
        activePointerId = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
        el.addEventListener('pointermove', elementDrag);
        el.addEventListener('pointerup', closeDragElement);
        el.addEventListener('pointercancel', closeDragElement);
    }

    function elementDrag(e) {
        e.preventDefault();
        // Calculate new cursor position
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        // Set the element's new position, bounding inside the canvas area
        let newTop = el.offsetTop - pos2;
        let newLeft = el.offsetLeft - pos1;

        // Boundaries
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + el.offsetWidth > parentEl.offsetWidth) newLeft = parentEl.offsetWidth - el.offsetWidth;
        if (newTop + el.offsetHeight > parentEl.offsetHeight) newTop = parentEl.offsetHeight - el.offsetHeight;

        el.style.top = `${newTop}px`;
        el.style.left = `${newLeft}px`;
    }

    function closeDragElement() {
        el.removeEventListener('pointermove', elementDrag);
        el.removeEventListener('pointerup', closeDragElement);
        el.removeEventListener('pointercancel', closeDragElement);
        if (activePointerId !== null) {
            try { el.releasePointerCapture(activePointerId); } catch (err) { /* already released */ }
            activePointerId = null;
        }
        saveCurrentOverlaysFromDOM();
    }
}

// Resizing overlays
function makeElementResizable(el, parentEl) {
    const handle = el.querySelector('.resize-handle');
    if (!handle) return;

    let resizePointerId = null;
    handle.addEventListener('pointerdown', initResize);

    function initResize(e) {
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        e.stopPropagation();

        // Mark the element active immediately upon dragging the resize handle
        document.querySelectorAll('.draggable-overlay').forEach(item => item.classList.remove('editing-active'));
        el.classList.add('editing-active');

        resizePointerId = e.pointerId;
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
        handle.addEventListener('pointermove', resize);
        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
    }

    function resize(e) {
        const rect = parentEl.getBoundingClientRect();
        let newWidth = e.clientX - rect.left - el.offsetLeft;
        let newHeight = e.clientY - rect.top - el.offsetTop;

        // Set minimum limits
        if (newWidth < 40) newWidth = 40;
        if (newHeight < 20) newHeight = 20;

        // Upper limit bounds
        if (el.offsetLeft + newWidth > parentEl.offsetWidth) newWidth = parentEl.offsetWidth - el.offsetLeft;
        if (el.offsetTop + newHeight > parentEl.offsetHeight) newHeight = parentEl.offsetHeight - el.offsetTop;

        el.style.width = `${newWidth}px`;
        el.style.height = `${newHeight}px`;

        // Adjust font size dynamically for text elements if resized
        if (el.classList.contains('text-element')) {
            const fontSize = Math.max(12, Math.floor(newHeight * 0.6));
            el.style.fontSize = `${fontSize}px`;
        }
    }

    function stopResize() {
        handle.removeEventListener('pointermove', resize);
        handle.removeEventListener('pointerup', stopResize);
        handle.removeEventListener('pointercancel', stopResize);
        if (resizePointerId !== null) {
            try { handle.releasePointerCapture(resizePointerId); } catch (err) { /* already released */ }
            resizePointerId = null;
        }
        saveCurrentOverlaysFromDOM();
    }
}

function enterTextEditMode(el) {
    // Add active styling classes
    document.querySelectorAll('.draggable-overlay').forEach(item => item.classList.remove('editing-active'));
    el.classList.add('editing-active');

    const textSpan = el.querySelector('.text-content');
    if (!textSpan) return;

    const currentVal = textSpan.innerText;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentVal;
    input.style.width = '100%';
    
    // Replace text element with input
    textSpan.replaceWith(input);
    input.focus();
    input.select();

    function exitEdit() {
        const newVal = input.value.trim() || 'Click to Edit';
        const span = document.createElement('span');
        span.className = 'text-content';
        span.innerText = newVal;
        input.replaceWith(span);
        saveCurrentOverlaysFromDOM();
    }

    input.addEventListener('blur', exitEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            exitEdit();
        }
    });
}

// Read positions and styles of current overlays in DOM and write back to state
function saveCurrentOverlaysFromDOM() {
    if (!state.edit.file) return;

    const wrapper = document.getElementById('canvas-workspace-wrapper');
    // Save drawings if present
    const drawCanvas = wrapper.querySelector('.drawing-layer-canvas');
    if (drawCanvas) {
        saveDrawingLayer(drawCanvas);
    }

    const overlayDOMs = wrapper.querySelectorAll('.draggable-overlay');
    
    const pageNum = state.edit.currentPageNum;
    state.edit.overlays[pageNum] = []; // Clear current list

    overlayDOMs.forEach(el => {
        let type = 'signature';
        if (el.classList.contains('text-element')) {
            type = 'text';
        } else if (el.classList.contains('redaction-element')) {
            type = 'redaction';
        } else if (el.classList.contains('image-element')) {
            type = 'image';
        } else if (el.classList.contains('signature-element')) {
            type = 'signature';
        }

        let val = '';
        if (type === 'text') {
            const span = el.querySelector('.text-content') || el.querySelector('input');
            val = span ? (span.innerText || span.value) : 'Text';
        } else if (type === 'redaction') {
            val = '';
        } else {
            val = el.querySelector('img').src;
        }

        // Read styling/position properties
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const fontSize = parseInt(window.getComputedStyle(el).fontSize) || 16;
        
        let fontFamily = 'Helvetica';
        let color = '#000000';

        if (type === 'text') {
            const fontStyle = el.style.fontFamily || '';
            if (fontStyle.includes('Times')) {
                fontFamily = 'Times Roman';
            } else if (fontStyle.includes('Courier')) {
                fontFamily = 'Courier';
            }
            color = rgbToHex(el.style.color);
        } else if (type === 'redaction') {
            color = rgbToHex(el.style.backgroundColor) || '#000000';
        }

        state.edit.overlays[pageNum].push({
            id: el.id,
            type,
            x,
            y,
            width,
            height,
            value: val,
            fontSize,
            fontFamily,
            color,
            // Store canvas dimensions for aspect ratio matching in compiler
            canvasWidth: wrapper.offsetWidth,
            canvasHeight: wrapper.offsetHeight
        });
    });
}

// ----------------------------------------
// SIGNATURE DRAWING PAD CONTROLLERS
// ----------------------------------------

function initSignaturePad() {
    const modal = document.getElementById('signature-modal');
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    signaturePad.canvas = canvas;
    signaturePad.ctx = ctx;

    const closeBtn = document.getElementById('close-sig-modal');
    const cancelBtn = document.getElementById('cancel-sig-btn');
    const saveBtn = document.getElementById('save-sig-btn');
    const clearBtn = document.getElementById('clear-sig-btn');
    const colorBtns = document.querySelectorAll('.color-btn');

    // Drawing coordinates tracking
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function startDrawing(e) {
        signaturePad.isDrawing = true;
        const pos = getMousePos(e);
        signaturePad.lastX = pos.x;
        signaturePad.lastY = pos.y;
    }

    function draw(e) {
        if (!signaturePad.isDrawing) return;
        
        const pos = getMousePos(e);
        ctx.beginPath();
        ctx.moveTo(signaturePad.lastX, signaturePad.lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = signaturePad.color;
        ctx.lineWidth = signaturePad.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        signaturePad.lastX = pos.x;
        signaturePad.lastY = pos.y;
    }

    function stopDrawing() {
        signaturePad.isDrawing = false;
    }

    // Desktop mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Mobile touch events
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        }
    });
    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            canvas.dispatchEvent(mouseEvent);
        }
    });
    canvas.addEventListener('touchend', () => {
        const mouseEvent = new MouseEvent('mouseup', {});
        canvas.dispatchEvent(mouseEvent);
    });

    // Close Modal triggers
    const closeModal = () => modal.classList.remove('active');
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    // Color Pickers
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            signaturePad.color = btn.getAttribute('data-color');
        });
    });

    // Save Signature & Place it on PDF
    saveBtn.addEventListener('click', () => {
        // Verify user drew something (simple check: if signature pad is empty)
        // Check if anything drawn by checking pixel transparency
        const buffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const hasContent = buffer.some(color => color !== 0);

        if (!hasContent) {
            alert('Please draw your signature before placing it.');
            return;
        }

        // Crop transparent outer margins of signature pad drawing
        const imgData = cropSignatureCanvas(canvas);
        
        // Add overlay sig image
        addOverlayElement({
            id: 'sig-' + Date.now(),
            type: 'signature',
            x: 100,
            y: 100,
            width: 150,
            height: 60,
            value: imgData
        });

        closeModal();
    });
}

/**
 * Crops empty transparent borders around canvas drawings.
 */
function cropSignatureCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    
    let minX = w, minY = h, maxX = 0, maxY = 0;
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const alpha = imgData.data[(y * w + x) * 4 + 3];
            if (alpha > 0) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    
    // If empty or no content found
    if (maxX < minX || maxY < minY) {
        return canvas.toDataURL('image/png');
    }
    
    // Crop with clean 12px padding
    const padding = 12;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const width = Math.min(w - x, (maxX - minX) + (padding * 2));
    const height = Math.min(h - y, (maxY - minY) + (padding * 2));
    
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');
    
    cropCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    return cropCanvas.toDataURL('image/png');
}

/**
 * Updates text toolbar controls status and value according to active overlay.
 */
function updateTextToolbar(el) {
    const textControls = document.getElementById('text-style-controls');
    if (!textControls) return;

    const familySelect = document.getElementById('font-family-select');
    const sizeSelect = document.getElementById('font-size-select');
    const colorPicker = document.getElementById('text-color-picker');

    if (el && el.classList.contains('text-element')) {
        textControls.style.display = 'flex';
        if (familySelect) familySelect.style.display = 'inline-block';
        if (sizeSelect) sizeSelect.style.display = 'inline-block';
        if (textControls.querySelector('span')) {
            textControls.querySelector('span').innerText = 'Font:';
        }
        
        const activeId = el.id;
        const pageNum = state.edit.currentPageNum;
        const savedOverlay = state.edit.overlays[pageNum] && state.edit.overlays[pageNum].find(item => item.id === activeId);
        
        if (savedOverlay) {
            familySelect.value = savedOverlay.fontFamily || 'Helvetica';
            sizeSelect.value = savedOverlay.fontSize || '16';
            colorPicker.value = savedOverlay.color || '#000000';
        } else {
            let fontFamily = 'Helvetica';
            if (el.style.fontFamily.includes('Times')) fontFamily = 'Times Roman';
            else if (el.style.fontFamily.includes('Courier')) fontFamily = 'Courier';
            
            familySelect.value = fontFamily;
            sizeSelect.value = parseInt(el.style.fontSize) || 16;
            colorPicker.value = rgbToHex(el.style.color) || '#000000';
        }
    } else if (el && el.classList.contains('redaction-element')) {
        textControls.style.display = 'flex';
        if (familySelect) familySelect.style.display = 'none';
        if (sizeSelect) sizeSelect.style.display = 'none';
        if (textControls.querySelector('span')) {
            textControls.querySelector('span').innerText = 'Color:';
        }
        
        const activeId = el.id;
        const pageNum = state.edit.currentPageNum;
        const savedOverlay = state.edit.overlays[pageNum] && state.edit.overlays[pageNum].find(item => item.id === activeId);
        
        if (savedOverlay) {
            colorPicker.value = savedOverlay.color || '#000000';
        } else {
            colorPicker.value = rgbToHex(el.style.backgroundColor) || '#000000';
        }
    } else {
        textControls.style.display = 'none';
    }
}

// Drawing layer dynamic canvas manager
function initDrawingLayer(wrapper, viewport) {
    const pageNum = state.edit.currentPageNum;
    
    // Create drawing canvas
    const drawCanvas = document.createElement('canvas');
    drawCanvas.className = 'drawing-layer-canvas';
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;
    wrapper.appendChild(drawCanvas);
    
    const ctx = drawCanvas.getContext('2d');
    
    // If we have saved drawings for this page, render them
    if (state.edit.drawings && state.edit.drawings[pageNum]) {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
        };
        img.src = state.edit.drawings[pageNum];
    }
    
    // Setup drawing handlers
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    
    const getPos = (e) => {
        const rect = drawCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };
    
    const startDraw = (e) => {
        if (!state.edit.activeTool || !['pen', 'highlighter'].includes(state.edit.activeTool)) return;
        isDrawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
    };
    
    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        
        const tool = state.edit.activeTool;
        const color = document.getElementById('drawing-color-picker').value || '#ff0000';
        const size = parseInt(document.getElementById('drawing-size-slider').value) || 5;
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (tool === 'highlighter') {
            ctx.lineWidth = size * 2.5;
            ctx.globalAlpha = 0.4;
            ctx.strokeStyle = color === '#ff0000' ? 'rgba(255, 235, 59, 1)' : color;
        } else {
            ctx.lineWidth = size;
            ctx.globalAlpha = 1.0;
        }
        
        ctx.stroke();
        
        lastX = pos.x;
        lastY = pos.y;
        ctx.globalAlpha = 1.0;
    };
    
    const stopDraw = () => {
        if (!isDrawing) return;
        isDrawing = false;
        saveDrawingLayer(drawCanvas);
    };
    
    drawCanvas.addEventListener('mousedown', startDraw);
    drawCanvas.addEventListener('mousemove', draw);
    drawCanvas.addEventListener('mouseup', stopDraw);
    drawCanvas.addEventListener('mouseout', stopDraw);
    
    drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
    drawCanvas.addEventListener('touchmove', draw, { passive: false });
    drawCanvas.addEventListener('touchend', stopDraw);
}

function saveDrawingLayer(canvas) {
    const pageNum = state.edit.currentPageNum;
    if (!state.edit.drawings) {
        state.edit.drawings = {};
    }
    
    const ctx = canvas.getContext('2d');
    const buffer = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = buffer.data;
    let hasPixels = false;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
            hasPixels = true;
            break;
        }
    }
    
    if (hasPixels) {
        state.edit.drawings[pageNum] = canvas.toDataURL();
    } else {
        delete state.edit.drawings[pageNum];
    }
}

/**
 * Converts rgb(r, g, b) string to Hex code #rrggbb.
 */
function rgbToHex(rgbStr) {
    if (!rgbStr) return '#000000';
    if (rgbStr.startsWith('#')) return rgbStr;
    const rgb = rgbStr.match(/\d+/g);
    if (!rgb || rgb.length < 3) return '#000000';
    return '#' + rgb.slice(0, 3).map(x => {
        const hex = parseInt(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

/**
 * Enable PWA Support by registering the Service Worker
 */
function initPWA() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then((registration) => {
                    console.log('[PWA] Service Worker registered successfully with scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('[PWA] Service Worker registration failed:', error);
                });
        });
    }
}

// ----------------------------------------
// TOOL: COMPRESS PDF WORKSPACE LOGIC
// ----------------------------------------

function initCompressWorkspace() { // Initialize compress workspace
    const resetBtn = document.getElementById('compress-reset-btn');
    const compressActionBtn = document.getElementById('compress-action-btn');
    const downloadBtn = document.getElementById('compress-download-btn');
    const workspace = document.getElementById('compress-workspace');
    
    if (!resetBtn || !compressActionBtn || !downloadBtn || !workspace) return;

    // Drag and drop on workspace
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleCompressFile(files);
            }
        }
    });

    // Make option cards clickable
    const optionCards = document.querySelectorAll('.compress-option-card');
    optionCards.forEach(card => {
        card.addEventListener('click', () => {
            optionCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) {
                radio.checked = true;
            }
        });
    });

    resetBtn.addEventListener('click', () => {
        state.compress.file = null;
        state.compress.originalSize = 0;
        state.compress.compressedBlob = null;

        document.getElementById('compress-drop-zone').style.display = 'flex';
        document.getElementById('compress-workspace').style.display = 'none';
        
        // Hide results card & show options sidebar controls
        document.getElementById('compress-results-card').style.display = 'none';
        document.getElementById('compress-initial-preview').style.display = 'flex';
        compressActionBtn.style.display = 'inline-flex';
        
    });

    compressActionBtn.addEventListener('click', async () => {
        if (!state.compress.file) return;
        await compressPDFAction();
    });

    downloadBtn.addEventListener('click', () => {
        if (!state.compress.compressedBlob || !state.compress.file) return;
        const url = URL.createObjectURL(state.compress.compressedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compressed_${state.compress.file.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
        URL.revokeObjectURL(url);
    });
}

async function handleCompressFile(files) {
    const file = files[0];
    state.compress.file = file;
    state.compress.originalSize = file.size;
    state.compress.compressedBlob = null;

    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdfDoc.numPages;

        // Show workspace
        document.getElementById('compress-drop-zone').style.display = 'none';
        document.getElementById('compress-workspace').style.display = 'flex';
        

        document.getElementById('compress-file-name').innerText = file.name;
        document.getElementById('compress-file-size').innerText = formatBytes(file.size);
        document.getElementById('compress-total-pages').innerText = totalPages;
        
        // Ensure options sidebar is visible and results card is hidden
        document.getElementById('compress-results-card').style.display = 'none';
        document.getElementById('compress-initial-preview').style.display = 'flex';
        document.getElementById('compress-action-btn').style.display = 'inline-flex';
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

async function compressPDFAction() {
    const selectedLevel = document.querySelector('input[name="compress-level"]:checked').value;
    
    // Extreme: 96 DPI, 0.40 quality.
    // Recommended: 150 DPI, 0.65 quality.
    // Low: 220 DPI, 0.85 quality.
    let dpi = 150;
    let quality = 0.65;

    if (selectedLevel === 'extreme') {
        dpi = 96;
        quality = 0.40;
    } else if (selectedLevel === 'low') {
        dpi = 220;
        quality = 0.85;
    }

    showLoading('Initializing compression...');
    
    try {
        const compressedBlob = await PDFTools.compressPDF(
            state.compress.file, 
            dpi, 
            quality, 
            (currentPage, totalPages) => {
                const percent = Math.round((currentPage / totalPages) * 100);
                showLoading(`Compressing PDF: Page ${currentPage} of ${totalPages} (${percent}%)...`);
            }
        );

        state.compress.compressedBlob = compressedBlob;

        // Populate results card
        const originalSizeStr = formatBytes(state.compress.originalSize);
        const compressedSizeStr = formatBytes(compressedBlob.size);
        
        let savingsPercent = 0;
        if (compressedBlob.size < state.compress.originalSize) {
            savingsPercent = Math.round(((state.compress.originalSize - compressedBlob.size) / state.compress.originalSize) * 100);
        }
        
        document.getElementById('compress-orig-size-val').innerText = originalSizeStr;
        document.getElementById('compress-new-size-val').innerText = compressedSizeStr;
        
        const savingsBadge = document.getElementById('compress-savings-badge');
        if (savingsPercent > 0) {
            savingsBadge.style.display = 'inline-flex';
            savingsBadge.innerHTML = `<i data-lucide="sparkles" style="width:16px; height:16px;"></i> ${savingsPercent}% Saved!`;
        } else {
            savingsBadge.style.display = 'inline-flex';
            savingsBadge.innerHTML = `<i data-lucide="info" style="width:16px; height:16px;"></i> Optimized (0% Saved)`;
        }
        
        // Hide preview and compress button, show results card
        document.getElementById('compress-initial-preview').style.display = 'none';
        document.getElementById('compress-action-btn').style.display = 'none';
        document.getElementById('compress-results-card').style.display = 'flex';
        
        lucide.createIcons();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(state.compress.file, 'An error occurred while compressing the PDF: ' + err.message);
    } finally {
        hideLoading();
    }
}

/**
 * Helper to format bytes to human readable sizes
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * What to tell someone whose file is encrypted. Many protected PDFs (bank
 * statements, Acrobat "restrict editing") open without a password and only
 * carry permission flags; Unlock PDF removes those without asking for one.
 */
function encryptedFileMessage(name, info) {
    const file = `"${name}"`;
    if (info.supported === false) {
        return `${file} is encrypted with a scheme PDFCraft can't remove, so this tool can't change it. ` +
            'Remove the protection in desktop PDF software first, then try again with that copy.';
    }
    if (info.opensWithoutPassword) {
        return `${file} is locked against changes. It opens without a password, so Unlock PDF can remove ` +
            'the lock: open Unlock PDF, add the file and press Unlock, then use the unlocked copy here.';
    }
    return `${file} is password-protected. Remove the password with Unlock PDF first (you will need ` +
        'to know it), then use the unlocked copy here.';
}

/**
 * Tools read PDFs with pdf-lib, which refuses any encrypted file, and pdf.js,
 * which cannot open one without its password. Both used to end in "Ensure
 * they are valid PDFs" or "Could not read PDF file", which sends people
 * looking for corruption. If one of the files is encrypted, say which one and
 * what to do; otherwise show the tool's own message.
 */
async function alertPdfFailure(files, fallback) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    for (const file of list) {
        let info;
        try {
            info = await PDFTools.encryptionInfo(file);
        } catch (e) {
            continue;
        }
        if (info.encrypted) {
            alert(encryptedFileMessage(file.name, info));
            return;
        }
    }
    alert(fallback);
}

// ----------------------------------------
// TOOL: REORDER PDF WORKSPACE LOGIC
// ----------------------------------------

function initReorderWorkspace() {
    const resetBtn = document.getElementById('reorder-reset-btn');
    const reorderActionBtn = document.getElementById('reorder-action-btn');
    const workspace = document.getElementById('reorder-workspace');
    if (!resetBtn || !reorderActionBtn || !workspace) return;

    // Drag and drop on workspace
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handleReorderFile(files);
            }
        }
    });

    resetBtn.addEventListener('click', () => {
        state.reorder.file = null;
        state.reorder.pdfDoc = null;
        state.reorder.totalPages = 0;
        state.reorder.order = [];

        document.getElementById('reorder-drop-zone').style.display = 'flex';
        document.getElementById('reorder-workspace').style.display = 'none';
    });

    reorderActionBtn.addEventListener('click', async () => {
        if (!state.reorder.file) return;
        await reorderPDFAction();
    });
}

async function handleReorderFile(files) {
    const file = files[0];
    state.reorder.file = file;
    state.reorder.order = [];

    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.reorder.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.reorder.totalPages = state.reorder.pdfDoc.numPages;

        // Initialize natural sequence: 0, 1, 2, ... totalPages-1
        for (let i = 0; i < state.reorder.totalPages; i++) {
            state.reorder.order.push(i);
        }

        // Show workspace
        document.getElementById('reorder-drop-zone').style.display = 'none';
        document.getElementById('reorder-workspace').style.display = 'flex';

        document.getElementById('reorder-file-name').innerText = file.name;
        document.getElementById('reorder-total-pages').innerText = `${state.reorder.totalPages} Pages`;

        renderReorderPagesList();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

// Move a page from one position to another and re-render, keeping focus on the
// page that moved so keyboard users do not lose their place.
function moveReorderPage(from, to) {
    const order = state.reorder.order;
    if (to < 0 || to >= order.length || from === to) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    renderReorderPagesList(to);
}

function renderReorderPagesList(focusIndex = null) {
    const grid = document.getElementById('reorder-pages-list');
    if (!grid) return;
    grid.innerHTML = '';

    const total = state.reorder.order.length;

    state.reorder.order.forEach((pageIdx, displayIdx) => {
        const pageNum = pageIdx + 1;
        const tile = document.createElement('div');
        tile.className = 'page-tile';
        tile.setAttribute('draggable', 'true');
        tile.setAttribute('data-index', displayIdx);
        // Drag-and-drop is mouse-only, so the tile is also focusable and carries
        // explicit move buttons. Those are the only route on touch and keyboard.
        tile.tabIndex = 0;
        tile.setAttribute('role', 'listitem');
        tile.setAttribute('aria-label', `Page ${pageNum}, position ${displayIdx + 1} of ${total}`);

        tile.innerHTML = `
            <div class="page-preview">
                <canvas id="reorder-canvas-${pageNum}"></canvas>
            </div>
            <div class="page-number">Page ${pageNum}</div>
            <div class="page-move-controls">
                <button type="button" class="page-move-btn" data-dir="-1"
                        aria-label="Move page ${pageNum} earlier"${displayIdx === 0 ? ' disabled' : ''}>&#8592;</button>
                <button type="button" class="page-move-btn" data-dir="1"
                        aria-label="Move page ${pageNum} later"${displayIdx === total - 1 ? ' disabled' : ''}>&#8594;</button>
            </div>
        `;

        tile.querySelectorAll('.page-move-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                moveReorderPage(displayIdx, displayIdx + parseInt(btn.dataset.dir, 10));
            });
            // Keep a button press from starting a tile drag.
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        });

        tile.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveReorderPage(displayIdx, displayIdx - 1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                moveReorderPage(displayIdx, displayIdx + 1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                moveReorderPage(displayIdx, 0);
            } else if (e.key === 'End') {
                e.preventDefault();
                moveReorderPage(displayIdx, total - 1);
            }
        });

        tile.addEventListener('dragstart', (e) => {
            tile.classList.add('file-tile-drag');
            e.dataTransfer.setData('text/plain', displayIdx);
            e.dataTransfer.effectAllowed = 'move';
        });

        tile.addEventListener('dragend', () => {
            tile.classList.remove('file-tile-drag');
        });

        tile.addEventListener('dragover', (e) => {
            e.preventDefault();
            tile.classList.add('drag-over');
        });

        tile.addEventListener('dragleave', () => {
            tile.classList.remove('drag-over');
        });

        tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drag-over');
            
            const dragIdx = parseInt(e.dataTransfer.getData('text/plain'));
            if (isNaN(dragIdx)) return;
            
            if (dragIdx !== displayIdx) {
                const movedItem = state.reorder.order.splice(dragIdx, 1)[0];
                state.reorder.order.splice(displayIdx, 0, movedItem);
                renderReorderPagesList();
            }
        });

        grid.appendChild(tile);

        const canvas = tile.querySelector('canvas');
        renderPageThumbnail(state.reorder.file, pageNum, canvas);
    });

    grid.setAttribute('role', 'list');

    if (focusIndex !== null) {
        const target = grid.querySelector(`.page-tile[data-index="${focusIndex}"]`);
        if (target) target.focus();
    }
}

async function reorderPDFAction() {
    showLoading('Reordering PDF pages...');
    try {
        const reorderedBlob = await PDFTools.reorderPDF(state.reorder.file, state.reorder.order);
        
        const url = URL.createObjectURL(reorderedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reordered_${state.reorder.file.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        await alertPdfFailure(state.reorder.file, 'Error reordering PDF pages.');
    } finally {
        hideLoading();
    }
}

// TOOL: PDF TO IMAGES WORKSPACE LOGIC
// ----------------------------------------

function initPdfToImagesWorkspace() {
    const resetBtn = document.getElementById('pdf-to-images-reset-btn');
    const actionBtn = document.getElementById('pdf-to-images-action-btn');
    const downloadBtn = document.getElementById('pdf-to-images-download-btn');
    const workspace = document.getElementById('pdf-to-images-workspace');

    if (!resetBtn || !actionBtn || !downloadBtn || !workspace) return;

    // Drag and drop on workspace
    ['dragenter', 'dragover'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.add('drag-over-active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        workspace.addEventListener(eventName, (e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                workspace.classList.remove('drag-over-active');
            }
        }, false);
    });

    workspace.addEventListener('drop', (e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            workspace.classList.remove('drag-over-active');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
            if (files.length > 0) {
                handlePdfToImagesFile(files);
            }
        }
    });

    // Make option cards clickable
    const optionCards = document.querySelectorAll('.pdf-to-images-option-card');
    optionCards.forEach(card => {
        card.addEventListener('click', () => {
            const containerName = card.dataset.group;
            const containerCards = document.querySelectorAll(`.pdf-to-images-option-card[data-group="${containerName}"]`);
            containerCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) {
                radio.checked = true;
            }
        });
    });

    resetBtn.addEventListener('click', () => {
        state.pdfToImages.file = null;
        state.pdfToImages.totalPages = 0;
        state.pdfToImages.zipBlob = null;

        document.getElementById('pdf-to-images-drop-zone').style.display = 'flex';
        document.getElementById('pdf-to-images-workspace').style.display = 'none';

        document.getElementById('pdf-to-images-results-card').style.display = 'none';
        document.getElementById('pdf-to-images-initial-preview').style.display = 'flex';
        actionBtn.style.display = 'inline-flex';

    });

    actionBtn.addEventListener('click', async () => {
        if (!state.pdfToImages.file) return;
        await pdfToImagesAction();
    });

    downloadBtn.addEventListener('click', () => {
        if (!state.pdfToImages.zipBlob || !state.pdfToImages.file) return;
        const url = URL.createObjectURL(state.pdfToImages.zipBlob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = state.pdfToImages.file.name.replace(/\.[^/.]+$/, "");
        a.download = `${baseName}_images.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
        URL.revokeObjectURL(url);
    });
}

async function handlePdfToImagesFile(files) {
    const file = files[0];
    state.pdfToImages.file = file;
    state.pdfToImages.zipBlob = null;

    showLoading('Loading PDF document...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdfDoc.numPages;
        state.pdfToImages.totalPages = totalPages;

        // Show workspace
        document.getElementById('pdf-to-images-drop-zone').style.display = 'none';
        document.getElementById('pdf-to-images-workspace').style.display = 'flex';


        document.getElementById('pdf-to-images-file-name').innerText = file.name;
        document.getElementById('pdf-to-images-file-size').innerText = formatBytes(file.size);
        document.getElementById('pdf-to-images-total-pages').innerText = totalPages;

        document.getElementById('pdf-to-images-results-card').style.display = 'none';
        document.getElementById('pdf-to-images-initial-preview').style.display = 'flex';
        document.getElementById('pdf-to-images-action-btn').style.display = 'inline-flex';
    } catch (err) {
        console.error(err);
        await alertPdfFailure(file, 'Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

async function pdfToImagesAction() {
    const selectedFormat = document.querySelector('input[name="pdf-to-images-format"]:checked').value;
    const selectedDpi = parseInt(document.querySelector('input[name="pdf-to-images-dpi"]:checked').value);

    // map format value to mime type
    const mimeType = selectedFormat === 'png' ? 'image/png' : 'image/jpeg';
    const quality = selectedFormat === 'png' ? 1.0 : 0.92;

    showLoading('Initializing image conversion...');

    try {
        const zipBlob = await PDFTools.pdfToImages(
            state.pdfToImages.file,
            { format: mimeType, dpi: selectedDpi, quality },
            (currentPage, totalPages) => {
                const percent = Math.round((currentPage / totalPages) * 100);
                showLoading(`Converting page ${currentPage} of ${totalPages} (${percent}%)...`);
            }
        );

        state.pdfToImages.zipBlob = zipBlob;

        // Populate results card
        document.getElementById('pdf-to-images-res-format').innerText = selectedFormat.toUpperCase();
        document.getElementById('pdf-to-images-res-pages').innerText = state.pdfToImages.totalPages;
        document.getElementById('pdf-to-images-res-size').innerText = formatBytes(zipBlob.size);

        // Hide configuration and convert button, show results card
        document.getElementById('pdf-to-images-initial-preview').style.display = 'none';
        document.getElementById('pdf-to-images-action-btn').style.display = 'none';
        document.getElementById('pdf-to-images-results-card').style.display = 'flex';

        lucide.createIcons();
    } catch (err) {
        console.error(err);
        await alertPdfFailure(state.pdfToImages.file, 'An error occurred during conversion: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ----------------------------------------
// TOOL: PROTECT PDF WORKSPACE LOGIC
// ----------------------------------------

function initProtectWorkspace() {
    const resetBtn = document.getElementById('protect-reset-btn');
    const protectActionBtn = document.getElementById('protect-action-btn');
    const downloadBtn = document.getElementById('protect-download-btn');
    const workspace = document.getElementById('protect-workspace');
    
    if (!resetBtn || !protectActionBtn || !downloadBtn || !workspace) return;

    resetBtn.addEventListener('click', () => {
        state.protect.file = null;
        state.protect.protectedBlob = null;
        document.getElementById('protect-password').value = '';
        document.getElementById('protect-password-confirm').value = '';
        document.getElementById('protect-results-card').style.display = 'none';
        document.getElementById('protect-workspace').style.display = 'none';
        document.getElementById('protect-drop-zone').style.display = 'flex';
    });

    protectActionBtn.addEventListener('click', protectPDFAction);
    downloadBtn.addEventListener('click', () => {
        if (!state.protect.protectedBlob) return;
        const name = state.protect.file.name.replace('.pdf', '') + '_protected.pdf';
        const url = URL.createObjectURL(state.protect.protectedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
        URL.revokeObjectURL(url);
    });
}

async function handleProtectFile(files) {
    const file = files[0];
    state.protect.file = file;
    state.protect.protectedBlob = null;

    showLoading('Checking PDF encryption...');
    try {
        // Guard against double-encryption. encryptPDF() opens the document with
        // ignoreEncryption:true, so running it on an already-protected PDF RC4s
        // the existing ciphertext a second time: the result opens with the new
        // password but its pages are empty, and the original password no longer
        // works. That is unrecoverable, so refuse rather than risk it.
        let alreadyEncrypted;
        try {
            alreadyEncrypted = await PDFTools.checkIsEncrypted(file);
        } catch (probeErr) {
            // checkIsEncrypted throws on encryption schemes we cannot parse
            // (e.g. AES-256 R5 or a certificate handler). "Cannot tell" is not "not encrypted",
            // and the downside of guessing wrong is a destroyed file.
            console.error('Encryption probe failed:', probeErr);
            const proceed = confirm(
                'We could not verify whether this PDF is already password protected.\n\n' +
                'Encrypting a PDF that is already protected will permanently damage it — ' +
                'the original password will stop working and the pages will be lost.\n\n' +
                'Only continue if you are certain this file has no password.'
            );
            if (!proceed) {
                state.protect.file = null;
                return;
            }
            alreadyEncrypted = false;
        }

        if (alreadyEncrypted) {
            state.protect.file = null;
            alert(
                'This PDF is already password protected.\n\n' +
                'Protecting it again would permanently damage the file. ' +
                'Please remove the existing password first using the Unlock PDF tool, ' +
                'then return here to set a new one.'
            );
            return;
        }

        // Show workspace
        document.getElementById('protect-drop-zone').style.display = 'none';
        document.getElementById('protect-workspace').style.display = 'block';
        

        document.getElementById('protect-file-name').innerText = file.name;
        document.getElementById('protect-preview-filename').innerText = file.name;
        document.getElementById('protect-preview-filesize').innerText = formatBytes(file.size);
        
        // Ensure inputs are visible and results hidden
        document.getElementById('protect-results-card').style.display = 'none';
        document.getElementById('protect-controls-layout').style.display = 'grid';
        document.getElementById('protect-action-btn').style.display = 'inline-flex';
        document.getElementById('protect-password').value = '';
        document.getElementById('protect-password-confirm').value = '';
    } catch (err) {
        console.error(err);
        alert('Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

async function protectPDFAction() {
    const password = document.getElementById('protect-password').value;
    const passwordConfirm = document.getElementById('protect-password-confirm').value;

    if (!password) {
        alert('Please enter a password.');
        return;
    }

    if (password !== passwordConfirm) {
        alert('Passwords do not match.');
        return;
    }

    showLoading('Encrypting PDF document...');
    try {
        const encryptedBlob = await PDFTools.protectPDF(state.protect.file, password);
        state.protect.protectedBlob = encryptedBlob;

        document.getElementById('protect-results-card').style.display = 'block';
        document.getElementById('protect-controls-layout').style.display = 'none';
    } catch (err) {
        console.error(err);
        alert('An error occurred during encryption: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ----------------------------------------
// TOOL: UNLOCK PDF WORKSPACE LOGIC
// ----------------------------------------

function initUnlockWorkspace() {
    const resetBtn = document.getElementById('unlock-reset-btn');
    const unlockActionBtn = document.getElementById('unlock-action-btn');
    const downloadBtn = document.getElementById('unlock-download-btn');
    const workspace = document.getElementById('unlock-workspace');
    
    if (!resetBtn || !unlockActionBtn || !downloadBtn || !workspace) return;

    resetBtn.addEventListener('click', () => {
        state.unlock.file = null;
        state.unlock.unlockedBlob = null;
        document.getElementById('unlock-password').value = '';
        document.getElementById('unlock-results-card').style.display = 'none';
        document.getElementById('unlock-workspace').style.display = 'none';
        document.getElementById('unlock-drop-zone').style.display = 'flex';
    });

    unlockActionBtn.addEventListener('click', unlockPDFAction);
    downloadBtn.addEventListener('click', () => {
        if (!state.unlock.unlockedBlob) return;
        const name = state.unlock.file.name.replace('.pdf', '') + '_unlocked.pdf';
        const url = URL.createObjectURL(state.unlock.unlockedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
            // Post-download support prompt
            if (typeof showPostDownloadSupportPrompt === "function") {
                showPostDownloadSupportPrompt();
            }
        URL.revokeObjectURL(url);
    });
}

async function handleUnlockFile(files) {
    const file = files[0];
    state.unlock.file = file;
    state.unlock.unlockedBlob = null;

    state.unlock.opensWithoutPassword = false;

    showLoading('Checking PDF encryption...');
    try {
        const info = await PDFTools.encryptionInfo(file);
        if (!info.encrypted) {
            alert('This PDF is not password protected.');
            return;
        }
        if (info.supported === false) {
            alert(`"${file.name}" uses an encryption scheme PDFCraft can't remove yet. ` +
                'Unlock PDF reads RC4, AES-128 and AES-256; desktop PDF software can remove this one.');
            return;
        }
        state.unlock.opensWithoutPassword = !!info.opensWithoutPassword;

        // Show workspace
        document.getElementById('unlock-drop-zone').style.display = 'none';
        document.getElementById('unlock-workspace').style.display = 'block';
        

        document.getElementById('unlock-file-name').innerText = file.name;
        document.getElementById('unlock-preview-filename').innerText = file.name;
        document.getElementById('unlock-preview-filesize').innerText = formatBytes(file.size);
        
        // Ensure inputs are visible and results hidden
        document.getElementById('unlock-results-card').style.display = 'none';
        document.getElementById('unlock-controls-layout').style.display = 'grid';
        document.getElementById('unlock-action-btn').style.display = 'inline-flex';
        document.getElementById('unlock-password').value = '';

        // A file that opens without a password has nothing to type: say so,
        // rather than asking for a password nobody has.
        const label = document.querySelector('label[for="unlock-password"]');
        const input = document.getElementById('unlock-password');
        const hint = document.getElementById('unlock-hint');
        const free = state.unlock.opensWithoutPassword;
        if (label) label.innerText = free ? 'Password (not needed for this file)' : 'Enter Password';
        if (input) input.placeholder = free ? 'Leave empty' : 'Enter password to unlock';
        if (hint) {
            hint.textContent = free
                ? 'This PDF opens without a password. It is only locked against changes such as editing or merging, so Unlock removes the lock without one.'
                : '';
            hint.hidden = !free;
        }
    } catch (err) {
        console.error(err);
        alert('Could not read PDF file.');
    } finally {
        hideLoading();
    }
}

async function unlockPDFAction() {
    const password = document.getElementById('unlock-password').value;

    if (!password && !state.unlock.opensWithoutPassword) {
        alert('Please enter a password.');
        return;
    }

    showLoading('Decrypting PDF document...');
    try {
        const decryptedBlob = await PDFTools.unlockPDF(state.unlock.file, password);
        state.unlock.unlockedBlob = decryptedBlob;

        document.getElementById('unlock-results-card').style.display = 'block';
        document.getElementById('unlock-controls-layout').style.display = 'none';
    } catch (err) {
        console.error(err);
        if (state.unlock.opensWithoutPassword && /Incorrect password/.test(err.message)) {
            alert('That password does not match. This file opens without one, so leave the password empty and press Unlock.');
        } else {
            alert('An error occurred during decryption. Please verify your password.');
        }
    } finally {
        hideLoading();
    }
}

// PDFCraft Post-Download Support Prompt Modal
function showPostDownloadSupportPrompt() {
    if (document.getElementById('support-modal')) return;

    // GA4 Event: PDF Download Conversion
    if (typeof window.gtag === 'function') {
        window.gtag('event', 'pdf_download', {
            'event_category': 'conversion',
            'event_label': state.currentTab || 'unknown',
            'value': 1
        });
    }

    // GA4 Event: Modal Shown
    if (typeof window.gtag === 'function') {
        window.gtag('event', 'kofi_modal_shown', {
            'event_category': 'support',
            'event_label': state.currentTab || 'unknown'
        });
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'support-modal';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 420px; text-align: center; padding: 2.25rem 2rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);">
            <div class="success-icon-wrapper" style="margin: 0 auto 1.25rem auto; width: 60px; height: 60px; background: var(--success-tint); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--success);">
                <i data-lucide="check-circle" style="width: 32px; height: 32px;"></i>
            </div>
            <h3 style="font-family: var(--font-heading); font-size: 1.35rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--text-main);">Download Started!</h3>
            <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.25rem;">
                Your document was processed <strong>100% locally</strong>. No files were uploaded, keeping your privacy completely secure.
            </p>
            <div class="support-prompt-box" style="background: var(--bg-primary); border: 1px dashed var(--border-color); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.5rem; text-align: center;">
                <p style="margin: 0 0 0.25rem 0; font-size: 0.85rem; font-weight: 600; color: var(--text-main);">PDFCraft runs without servers!</p>
                <p style="margin: 0; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
                    Help us keep these tools free and private. Support our local model by buying us a coffee.
                </p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <a href="https://ko-fi.com/pdfcraft" target="_blank" rel="noopener" id="kofi-donate-btn" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; text-decoration: none; width: 100%;">
                    <i data-lucide="coffee"></i> Support PDFCraft on Ko-fi
                </a>
                <button id="share-pdfcraft-btn" class="btn btn-secondary" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%;">
                    <i data-lucide="share-2"></i> Share PDFCraft
                </button>
                <button class="btn btn-secondary" id="close-support-btn" style="width: 100%;">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    
    // Initialize Lucide icons inside modal
    if (window.lucide) {
        window.lucide.createIcons({
            attrs: {
                class: 'lucide-icon'
            },
            nameAttr: 'data-lucide'
        });
    }

    // GA4 Event: Donate click
    const donateBtn = modal.querySelector('#kofi-donate-btn');
    donateBtn.addEventListener('click', () => {
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'kofi_click', {
                'event_category': 'support',
                'event_label': state.currentTab || 'unknown'
            });
        }
    });

    // Share Button Event (Native Share or Clipboard Copy)
    const shareBtn = modal.querySelector('#share-pdfcraft-btn');
    shareBtn.addEventListener('click', () => {
        // GA4 Event: Share click
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'share_click', {
                'event_category': 'viral',
                'event_label': state.currentTab || 'unknown'
            });
        }

        if (navigator.share) {
            navigator.share({
                title: 'PDFCraft - Free Private Online PDF Editor',
                text: 'I just edited my PDF securely and privately using PDFCraft. No file uploads, processed 100% locally in-browser!',
                url: 'https://pdf-craft.online/'
            }).catch(console.error);
        } else {
            // Fallback: Copy to clipboard
            navigator.clipboard.writeText('https://pdf-craft.online/').then(() => {
                const originalHtml = shareBtn.innerHTML;
                shareBtn.innerHTML = '<i data-lucide="check"></i> Copied to Clipboard!';
                if (window.lucide) {
                    window.lucide.createIcons({
                        attrs: { class: 'lucide-icon' },
                        nameAttr: 'data-lucide'
                    });
                }
                setTimeout(() => {
                    shareBtn.innerHTML = originalHtml;
                    if (window.lucide) {
                        window.lucide.createIcons({
                            attrs: { class: 'lucide-icon' },
                            nameAttr: 'data-lucide'
                        });
                    }
                }, 2000);
            }).catch(err => {
                console.error('Could not copy link: ', err);
            });
        }
    });

    const closeBtn = modal.querySelector('#close-support-btn');
    const closeModal = () => {
        modal.classList.remove('active');
        setTimeout(() => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }, 300);
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

// PDFCraft PWA Standalone Mode Check
function initPwaSponsorCheck() {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isPWA) {
        const sponsorNav = document.querySelector('.nav-btn-sponsor span');
        if (sponsorNav) {
            sponsorNav.innerHTML = 'Support PWA & Donate';
        }
    }
}

// ----------------------------------------
// TOOL: ADD PAGE NUMBERS WORKSPACE LOGIC
// ----------------------------------------

function initNumberWorkspace() {
    const resetBtn = document.getElementById('number-reset-btn');
    const numberActionBtn = document.getElementById('number-action-btn');
    const downloadBtn = document.getElementById('number-download-btn');
    const workspace = document.getElementById('number-workspace');
    
    if (!resetBtn || !numberActionBtn || !downloadBtn || !workspace) return;

    resetBtn.addEventListener('click', () => {
        state.number.file = null;
        state.number.numberedBlob = null;
        document.getElementById('number-page-range').value = 'all';
        document.getElementById('number-start-idx').value = '1';
        document.getElementById('number-results-card').style.display = 'none';
        document.getElementById('number-workspace').style.display = 'none';
        document.getElementById('number-drop-zone').style.display = 'flex';

        // Reset preview canvas
        const canvas = document.getElementById('number-preview-canvas');
        const placeholder = document.getElementById('number-preview-placeholder');
        if (canvas && placeholder) {
            canvas.style.display = 'none';
            placeholder.style.display = 'flex';
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    });

    numberActionBtn.addEventListener('click', numberPDFAction);
    
    downloadBtn.addEventListener('click', () => {
        if (!state.number.numberedBlob) return;
        const name = state.number.file.name.replace('.pdf', '') + '_numbered.pdf';
        const url = URL.createObjectURL(state.number.numberedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        if (typeof showPostDownloadSupportPrompt === "function") {
            showPostDownloadSupportPrompt();
        }
        URL.revokeObjectURL(url);
    });
}

function handleNumberFile(files) {
    const file = files[0];
    state.number.file = file;
    state.number.numberedBlob = null;

    document.getElementById('number-drop-zone').style.display = 'none';
    document.getElementById('number-workspace').style.display = 'block';
    

    document.getElementById('number-file-name').innerText = file.name;
    document.getElementById('number-preview-filename').innerText = file.name;
    document.getElementById('number-preview-filesize').innerText = formatBytes(file.size);
    
    document.getElementById('number-results-card').style.display = 'none';
    document.getElementById('number-controls-layout').style.display = 'grid';
    document.getElementById('number-action-btn').style.display = 'inline-flex';

    // Render first page preview
    const canvas = document.getElementById('number-preview-canvas');
    const placeholder = document.getElementById('number-preview-placeholder');
    if (canvas && placeholder) {
        canvas.style.display = 'block';
        placeholder.style.display = 'none';
        renderLargePreview(file, 1, canvas);
    }
}

async function numberPDFAction() {
    const position = document.getElementById('number-position').value;
    const format = document.getElementById('number-format').value;
    const fontSize = parseInt(document.getElementById('number-font-size').value) || 10;
    const startNumber = parseInt(document.getElementById('number-start-idx').value) || 1;
    const pageRange = document.getElementById('number-page-range').value || 'all';
    const fontColor = document.getElementById('number-font-color').value || '#000000';

    showLoading('Numbering PDF document...');
    try {
        const numberedBlob = await PDFTools.addPageNumbers(state.number.file, {
            position,
            format,
            fontSize,
            startNumber,
            pageRange,
            fontColor
        });
        state.number.numberedBlob = numberedBlob;

        document.getElementById('number-results-card').style.display = 'block';
        document.getElementById('number-controls-layout').style.display = 'none';
    } catch (err) {
        console.error(err);
        await alertPdfFailure(state.number.file, 'An error occurred during numbering: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ----------------------------------------
// TOOL: WATERMARK PDF WORKSPACE LOGIC
// ----------------------------------------

function initWatermarkWorkspace() {
    const resetBtn = document.getElementById('watermark-reset-btn');
    const watermarkActionBtn = document.getElementById('watermark-action-btn');
    const downloadBtn = document.getElementById('watermark-download-btn');
    const workspace = document.getElementById('watermark-workspace');
    
    if (!resetBtn || !watermarkActionBtn || !downloadBtn || !workspace) return;

    resetBtn.addEventListener('click', () => {
        state.watermark.file = null;
        state.watermark.watermarkedBlob = null;
        document.getElementById('watermark-text').value = 'DRAFT';
        document.getElementById('watermark-results-card').style.display = 'none';
        document.getElementById('watermark-workspace').style.display = 'none';
        document.getElementById('watermark-drop-zone').style.display = 'flex';

        // Reset preview canvas
        const canvas = document.getElementById('watermark-preview-canvas');
        const placeholder = document.getElementById('watermark-preview-placeholder');
        if (canvas && placeholder) {
            canvas.style.display = 'none';
            placeholder.style.display = 'flex';
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    });

    watermarkActionBtn.addEventListener('click', watermarkPDFAction);
    
    downloadBtn.addEventListener('click', () => {
        if (!state.watermark.watermarkedBlob) return;
        const name = state.watermark.file.name.replace('.pdf', '') + '_watermarked.pdf';
        const url = URL.createObjectURL(state.watermark.watermarkedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        if (typeof showPostDownloadSupportPrompt === "function") {
            showPostDownloadSupportPrompt();
        }
        URL.revokeObjectURL(url);
    });
}

function handleWatermarkFile(files) {
    const file = files[0];
    state.watermark.file = file;
    state.watermark.watermarkedBlob = null;

    document.getElementById('watermark-drop-zone').style.display = 'none';
    document.getElementById('watermark-workspace').style.display = 'block';
    

    document.getElementById('watermark-file-name').innerText = file.name;
    document.getElementById('watermark-preview-filename').innerText = file.name;
    document.getElementById('watermark-preview-filesize').innerText = formatBytes(file.size);
    
    document.getElementById('watermark-results-card').style.display = 'none';
    document.getElementById('watermark-controls-layout').style.display = 'grid';
    document.getElementById('watermark-action-btn').style.display = 'inline-flex';

    // Render first page preview
    const canvas = document.getElementById('watermark-preview-canvas');
    const placeholder = document.getElementById('watermark-preview-placeholder');
    if (canvas && placeholder) {
        canvas.style.display = 'block';
        placeholder.style.display = 'none';
        renderLargePreview(file, 1, canvas);
    }
}

async function watermarkPDFAction() {
    const text = document.getElementById('watermark-text').value || 'DRAFT';
    const fontSize = parseInt(document.getElementById('watermark-font-size').value) || 50;
    const opacity = parseFloat(document.getElementById('watermark-opacity').value) || 0.3;
    // 0 is a real choice (a level watermark), so only fall back when the field is empty;
    // `parseInt(...) || 45` turned a typed 0 into 45 and made horizontal impossible.
    const rotationInput = parseInt(document.getElementById('watermark-rotation').value, 10);
    const rotation = Number.isNaN(rotationInput) ? 45 : rotationInput;
    const fontColor = document.getElementById('watermark-font-color').value || '#000000';

    showLoading('Watermarking PDF document...');
    try {
        const watermarkedBlob = await PDFTools.addWatermark(state.watermark.file, {
            text,
            fontSize,
            opacity,
            rotation,
            fontColor
        });
        state.watermark.watermarkedBlob = watermarkedBlob;

        document.getElementById('watermark-results-card').style.display = 'block';
        document.getElementById('watermark-controls-layout').style.display = 'none';
    } catch (err) {
        console.error(err);
        await alertPdfFailure(state.watermark.file, 'An error occurred during watermarking: ' + err.message);
    } finally {
        hideLoading();
    }
}

/* =========================================================================
 * Edit PDF Text
 *
 * Unlike Sign & Edit, which draws overlays on top of a page, this tool
 * REPLACES text that is already in the document: the original text-showing
 * operator is spliced out of the content stream and the replacement drawn in
 * its place. The engine lives in PDFTools.replaceTextInPDF.
 *
 * The UI's job is to turn a click on the rendered canvas into the geometry the
 * engine matches on. pdf.js gives us text items with a transform matrix in PDF
 * user space; the engine finds every text operator sitting on that baseline
 * within the item's span. We therefore pass x / y / width / fontSize straight
 * through and never try to match on the string itself — for a subset font the
 * bytes in the stream are glyph indices, not characters.
 * ========================================================================= */

function initEditTextWorkspace() {
    const dropZone = document.getElementById('edit-text-drop-zone');
    if (!dropZone) return;   // not this page

    const applyBtn = document.getElementById('edit-text-action-btn');
    const resetBtn = document.getElementById('edit-text-reset-btn');
    const prevBtn = document.getElementById('edit-text-prev-page');
    const nextBtn = document.getElementById('edit-text-next-page');
    const cancelBtn = document.getElementById('edit-text-cancel-edit');
    const saveBtn = document.getElementById('edit-text-save-edit');
    const input = document.getElementById('edit-text-input');

    if (applyBtn) applyBtn.addEventListener('click', applyTextEdits);
    if (resetBtn) resetBtn.addEventListener('click', resetEditText);
    if (prevBtn) prevBtn.addEventListener('click', () => gotoEditTextPage(state.editText.currentPageNum - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => gotoEditTextPage(state.editText.currentPageNum + 1));
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditTextDialog);
    if (saveBtn) saveBtn.addEventListener('click', commitEditTextDialog);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEditTextDialog(); }
            if (e.key === 'Escape') closeEditTextDialog();
        });
    }
}

async function handleEditTextFile(files) {
    const file = files[0];
    if (!file) return;

    showLoading('Reading PDF...');
    try {
        const buf = await file.arrayBuffer();

        // Refuse encrypted input up front. The engine refuses too, but finding
        // out after the user has typed replacements is a poor experience.
        try {
            const info = await PDFTools.encryptionInfo(file);
            if (info.encrypted) {
                alert(encryptedFileMessage(file.name, info));
                return;
            }
        } catch (e) {
            // Could not inspect the file; let the load attempt below decide
            // rather than blocking a readable file.
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        state.editText.file = file;
        state.editText.pdfDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        state.editText.totalPages = state.editText.pdfDoc.numPages;
        state.editText.currentPageNum = 1;
        state.editText.edits = {};
        state.editText.resultBlob = null;
        state.editText.warnings = [];
        state.editText.runCache = {};
        // Parsed once so every page can be matched to its operators. If
        // pdf-lib cannot read the file, hotspots fall back to raw pdf.js items.
        try {
            state.editText.libDoc = await window.PDFLib.PDFDocument.load(new Uint8Array(buf.slice(0)));
        } catch (e) {
            console.warn('pdf-lib could not parse this file; text grouping disabled.', e);
            state.editText.libDoc = null;
        }

        document.getElementById('edit-text-drop-zone').style.display = 'none';
        document.getElementById('edit-text-workspace').style.display = 'block';

        const nameEl = document.getElementById('edit-text-file-name');
        if (nameEl) nameEl.innerText = file.name;

        await renderEditTextPage(1);
    } catch (err) {
        console.error(err);
        alert('Could not read this PDF. If it is password protected, unlock it first.');
    } finally {
        hideLoading();
    }
}

async function renderEditTextPage(pageNum) {
    const st = state.editText;
    st.currentPageNum = pageNum;

    const wrapper = document.getElementById('edit-text-canvas-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    showLoading(`Rendering page ${pageNum}...`);
    try {
        const page = await st.pdfDoc.getPage(pageNum);
        const container = document.getElementById('edit-text-canvas-container');
        const avail = (container ? container.clientWidth : 800) - 48;
        const base = page.getViewport({ scale: 1.0 });
        let scale = avail / base.width;
        scale = Math.min(Math.max(scale, window.innerWidth <= 768 ? 0.3 : 0.8), 1.6);

        const viewport = page.getViewport({ scale });
        st.viewport = viewport;

        const canvas = document.createElement('canvas');
        const ratio = sharpCanvas(canvas, viewport);
        canvas.className = 'edit-text-canvas';
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
        wrapper.appendChild(canvas);

        // Start rasterising, but do NOT block the interactive layer on it.
        // Hotspots only need the viewport and the text content, so gating them
        // on the bitmap just makes a big page feel dead while it paints. It
        // also means a stalled rasteriser cannot take the whole tool down —
        // pdf.js drives rendering off requestAnimationFrame, which browsers
        // suspend entirely while the tab is hidden.
        const renderTask = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
        });
        renderTask.promise.catch(err => console.error('Page raster failed:', err));

        // Build the clickable layer from pdf.js text items, grouped so each
        // hotspot covers whole content-stream operators: the engine can only
        // remove whole operators, so a hotspot for part of one would delete
        // the rest of it. Positions are PDF user space;
        // viewport.convertToViewportPoint maps them to canvas pixels.
        const tc = await page.getTextContent();
        st.rawItems = tc.items.filter(i => i.str && i.str.trim()).map(i => ({
            str: i.str,
            x: i.transform[4],
            y: i.transform[5],
            width: i.width,
            fontSize: Math.abs(i.transform[3]),
        }));
        let runs = null;
        if (st.libDoc) {
            try {
                if (!st.runCache[pageNum]) st.runCache[pageNum] = await PDFTools.listTextRuns(st.libDoc, pageNum);
                runs = st.runCache[pageNum];
            } catch (e) {
                console.warn('Could not scan this page\'s content stream; text grouping disabled.', e);
            }
        }
        st.items = runs ? PDFTools.groupTextItems(st.rawItems, runs) : st.rawItems;

        st.items.forEach((item, idx) => {
            const [x, y] = viewport.convertToViewportPoint(item.x, item.y);
            const h = item.fontSize * scale;
            const w = item.width * scale;

            const hot = document.createElement('button');
            hot.type = 'button';
            hot.className = 'edit-text-hotspot';
            hot.style.left = `${x}px`;
            hot.style.top = `${y - h}px`;
            hot.style.width = `${Math.max(w, 8)}px`;
            hot.style.height = `${Math.max(h, 10)}px`;
            hot.title = `Edit: "${item.str}"`;
            hot.setAttribute('aria-label', `Edit text: ${item.str}`);

            const edit = (st.edits[pageNum] || []).find(e => e.itemIndex === idx);
            if (edit) hot.classList.add('is-edited');

            hot.addEventListener('click', () => openEditTextDialog(idx));
            wrapper.appendChild(hot);
        });

        const label = document.getElementById('edit-text-page-label');
        if (label) label.innerText = `Page ${pageNum} of ${st.totalPages}`;
        const prev = document.getElementById('edit-text-prev-page');
        const next = document.getElementById('edit-text-next-page');
        if (prev) prev.disabled = pageNum <= 1;
        if (next) next.disabled = pageNum >= st.totalPages;

        renderEditTextList();
    } catch (err) {
        console.error(err);
        alert('Could not render this page.');
    } finally {
        hideLoading();
    }
}

function gotoEditTextPage(n) {
    const st = state.editText;
    if (n < 1 || n > st.totalPages) return;
    renderEditTextPage(n);
}

function openEditTextDialog(itemIndex) {
    const st = state.editText;
    const item = st.items[itemIndex];
    if (!item) return;

    st._editingIndex = itemIndex;
    const existing = (st.edits[st.currentPageNum] || []).find(e => e.itemIndex === itemIndex);

    const dlg = document.getElementById('edit-text-dialog');
    const orig = document.getElementById('edit-text-original');
    const input = document.getElementById('edit-text-input');
    if (!dlg || !input) return;

    if (orig) orig.innerText = item.str;
    input.value = existing ? existing.replacement : item.str;
    dlg.style.display = 'flex';
    input.focus();
    input.select();
}

function closeEditTextDialog() {
    const dlg = document.getElementById('edit-text-dialog');
    if (dlg) dlg.style.display = 'none';
    state.editText._editingIndex = null;
}

function commitEditTextDialog() {
    const st = state.editText;
    const idx = st._editingIndex;
    if (idx === null || idx === undefined) return;

    const item = st.items[idx];
    const input = document.getElementById('edit-text-input');
    const value = input.value;

    const page = st.currentPageNum;
    st.edits[page] = (st.edits[page] || []).filter(e => e.itemIndex !== idx);

    // Storing the original text only so the list can show a before/after; the
    // engine never matches on it.
    if (value !== item.str) {
        const yTol = Math.max(1.5, (item.fontSize || 12) * 0.3);
        st.edits[page].push({
            itemIndex: idx,
            original: item.str,
            replacement: value,
            x: item.x,
            y: item.y,
            width: item.width,
            fontSize: item.fontSize,
            // Every word on this line, so the engine can refuse an edit that
            // would delete text outside the clicked span.
            lineItems: st.rawItems
                .filter(r => Math.abs(r.y - item.y) <= yTol)
                .map(r => ({ x: r.x, width: r.width }))
        });
    }

    closeEditTextDialog();
    renderEditTextPage(page);
}

function renderEditTextList() {
    const st = state.editText;
    const list = document.getElementById('edit-text-list');
    const countEl = document.getElementById('edit-text-count');
    if (!list) return;

    const all = Object.entries(st.edits).flatMap(([p, arr]) => arr.map(e => ({ ...e, page: Number(p) })));
    if (countEl) countEl.innerText = String(all.length);

    const applyBtn = document.getElementById('edit-text-action-btn');
    if (applyBtn) applyBtn.disabled = all.length === 0;

    if (!all.length) {
        list.innerHTML = '<p class="edit-text-empty">Click any text on the page to replace it.</p>';
        return;
    }

    list.innerHTML = all.map(e => `
        <div class="edit-text-row">
            <span class="edit-text-page-tag">p${e.page}</span>
            <span class="edit-text-before">${escapeHtmlText(e.original)}</span>
            <i data-lucide="arrow-right"></i>
            <span class="edit-text-after">${escapeHtmlText(e.replacement)}</span>
        </div>`).join('');
    if (window.lucide) lucide.createIcons();
}

// Filenames and document text are user-controlled; never interpolate raw.
function escapeHtmlText(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

async function applyTextEdits() {
    const st = state.editText;
    const edits = Object.entries(st.edits).flatMap(([p, arr]) =>
        arr.map(e => ({
            pageNum: Number(p),
            x: e.x, y: e.y, width: e.width, fontSize: e.fontSize,
            lineItems: e.lineItems,
            newText: e.replacement
        }))
    );
    if (!edits.length) return;

    showLoading('Rewriting text...');
    try {
        const { blob, warnings } = await PDFTools.replaceTextInPDF(st.file, edits);
        st.resultBlob = blob;
        st.warnings = warnings || [];

        document.getElementById('edit-text-controls-layout').style.display = 'none';
        document.getElementById('edit-text-action-btn').style.display = 'none';
        const results = document.getElementById('edit-text-results-card');
        results.style.display = 'block';

        const warnBox = document.getElementById('edit-text-warnings');
        if (warnBox) {
            warnBox.innerHTML = st.warnings.length
                ? '<ul>' + st.warnings.map(w => `<li>${escapeHtmlText(w)}</li>`).join('') + '</ul>'
                : '';
        }

        const dl = document.getElementById('edit-text-download-btn');
        if (dl) {
            dl.onclick = () => {
                // Same inline pattern the other tools use; there is no shared helper.
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = st.file.name.replace(/\.pdf$/i, '') + '-edited.pdf';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (typeof showPostDownloadSupportPrompt === 'function') {
                    showPostDownloadSupportPrompt();
                }
                URL.revokeObjectURL(url);
            };
        }
    } catch (err) {
        console.error(err);
        alert(err.message || 'Could not rewrite the text in this PDF.');
    } finally {
        hideLoading();
    }
}

function resetEditText() {
    const st = state.editText;
    st.file = null; st.pdfDoc = null; st.edits = {}; st.items = [];
    st.rawItems = []; st.libDoc = null; st.runCache = {};
    st.resultBlob = null; st.warnings = []; st.currentPageNum = 1;

    document.getElementById('edit-text-workspace').style.display = 'none';
    document.getElementById('edit-text-drop-zone').style.display = 'flex';
    document.getElementById('edit-text-results-card').style.display = 'none';
    document.getElementById('edit-text-controls-layout').style.display = 'grid';
    document.getElementById('edit-text-action-btn').style.display = 'inline-flex';
    const input = document.getElementById('edit-text-file-input');
    if (input) input.value = '';

    // Clear per-file UI, otherwise the next document opens with the previous
    // one's dialog state and a still-enabled Apply button.
    closeEditTextDialog();
    const applyBtn = document.getElementById('edit-text-action-btn');
    if (applyBtn) applyBtn.disabled = true;
    const countEl = document.getElementById('edit-text-count');
    if (countEl) countEl.innerText = '0';
    const list = document.getElementById('edit-text-list');
    if (list) list.innerHTML = '<p class="edit-text-empty">Click any text on the page to replace it.</p>';
    const wrapper = document.getElementById('edit-text-canvas-wrapper');
    if (wrapper) { wrapper.innerHTML = ''; wrapper.style.width = ''; wrapper.style.height = ''; }
    const warn = document.getElementById('edit-text-warnings');
    if (warn) warn.innerHTML = '';
}
