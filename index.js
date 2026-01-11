document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // 1. CONFIGURATION & STATE
    // =========================================================================
    
    const STORAGE_KEY = 'trinh_hg_settings_v29_final';
    const INPUT_STATE_KEY = 'trinh_hg_input_v29';
  
    // MARKERS
    const MARK_REP_START  = '\uE000'; 
    const MARK_REP_END    = '\uE001';
    const MARK_CAP_START  = '\uE002'; // Auto Caps (Blue)
    const MARK_CAP_END    = '\uE003';
    const MARK_BOTH_START = '\uE004'; // Replace + Auto Caps (Orange)
    const MARK_BOTH_END   = '\uE005';
  
    const defaultState = {
      currentMode: 'default',
      activeTab: 'settings',
      dialogueMode: 0, 
      abnormalCapsMode: 0,
      regexMode: 'chapter',
      customRegex: '',
      modes: {
        default: { 
            pairs: [], 
            matchCase: false, 
            wholeWord: false, 
            autoCaps: false
        }
      }
    };
  
    let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
    if (!state.activeTab) state.activeTab = 'settings';
    
    // Đảm bảo cấu trúc dữ liệu
    if (state.dialogueMode === undefined) state.dialogueMode = 0;
    if (state.abnormalCapsMode === undefined) state.abnormalCapsMode = 0;
    if (!state.modes || Object.keys(state.modes).length === 0) {
        state.modes = JSON.parse(JSON.stringify(defaultState.modes));
        state.currentMode = 'default';
    }
    if (!state.modes[state.currentMode]) state.currentMode = Object.keys(state.modes)[0] || 'default';
  
    let currentSplitMode = 2;
    let saveTimeout;

    // ANTI-FLICKER LOGIC (Xóa class loading để hiện giao diện)
    document.body.classList.remove('loading');
    document.querySelectorAll('.tab-button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === state.activeTab);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === state.activeTab);
    });
  
    // =========================================================================
    // 2. DOM ELEMENTS
    // =========================================================================
    const els = {
      tabButtons: document.querySelectorAll('.tab-button'),
      sidebarBtns: document.querySelectorAll('.sidebar-btn'),
      settingPanels: document.querySelectorAll('.setting-panel'),
      modeSelect: document.getElementById('mode-select'),
      list: document.getElementById('punctuation-list'),
      
      // *** ĐÃ FIX: Thêm dòng này để tránh lỗi undefined ***
      emptyState: document.getElementById('empty-state'), 
      
      // Toolbar
      matchCaseBtn: document.getElementById('match-case'),
      wholeWordBtn: document.getElementById('whole-word'),
      autoCapsBtn: document.getElementById('auto-caps'), 
      
      formatCards: document.querySelectorAll('.format-card:not(.ab-caps-card)'),
      abCapsCards: document.querySelectorAll('.ab-caps-card'),
      
      customRegexInput: document.getElementById('custom-regex-input'),
      saveRegexBtn: document.getElementById('save-regex-settings'),
      
      inputText: document.getElementById('input-text'),
      outputText: document.getElementById('output-text'),
      replaceBtn: document.getElementById('replace-button'),
      copyBtn: document.getElementById('copy-button'),
      
      splitInput: document.getElementById('split-input-text'),
      splitWrapper: document.getElementById('split-outputs-wrapper'),
      splitTypeRadios: document.getElementsByName('split-type'),
      splitControlCount: document.getElementById('split-type-count'),
      splitControlRegex: document.getElementById('split-type-regex'),
      splitActionBtn: document.getElementById('split-action-btn'),
      
      inputCount: document.getElementById('input-word-count'),
      outputCount: document.getElementById('output-word-count'),
      replaceCountBadge: document.getElementById('count-replace'),
      capsCountBadge: document.getElementById('count-caps'),
      splitInputCount: document.getElementById('split-input-word-count')
    };

    // =========================================================================
    // 3. LOGIC XỬ LÝ TEXT (CORE)
    // =========================================================================
    
    function saveState() { 
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); 
    }
    
    function showNotification(msg, type = 'success') {
      const container = document.getElementById('notification-container');
      const note = document.createElement('div');
      note.className = `notification ${type}`;
      note.textContent = msg;
      container.appendChild(note);
      setTimeout(() => { note.style.opacity = '0'; setTimeout(() => note.remove(), 300); }, 2000); 
    }

    function showInlineNotify(btn, msg) {
        const originalText = btn.dataset.text || btn.textContent;
        if (!btn.dataset.text) btn.dataset.text = originalText;
        btn.textContent = msg;
        setTimeout(() => { btn.textContent = originalText; }, 1500);
    }
    
    function escapeHTML(str) { return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
    function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function preserveCase(o, r) {
        if (o === o.toUpperCase() && o !== o.toLowerCase()) return r.toUpperCase();
        if (o[0] === o[0].toUpperCase()) return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
        return r;
    }
    function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }
    function normalizeInput(text) { return text ? text.normalize('NFC').replace(/\u00A0/g, ' ') : ''; }

    // Format Dialogue
    function formatDialogue(text, mode) {
        if (mode == 0) return text;
        const regex = /(^|[\n])([^:\n]+):\s*([“"'])([\s\S]*?)([”"'])/gm;
        return text.replace(regex, (match, p1, p2, p3, p4, p5) => {
            const context = p2.trim();
            let content = p4.trim();
            if (mode == 1) return `${p1}${context}: ${p3}${content}${p5}`;
            else if (mode == 2) return `${p1}${context}:\n\n${p3}${content}${p5}`;
            else if (mode == 3) return `${p1}${context}:\n\n- ${content}`;
            return match;
        });
    }

    // MAIN PIPELINE
    function performReplaceAll() {
        const rawText = els.inputText.value;
        if (!rawText) { showInlineNotify(els.replaceBtn, "Chưa có nội dung!"); return; }

        requestAnimationFrame(() => {
            try {
                let processedText = normalizeInput(rawText);
                const mode = state.modes[state.currentMode];
                let countReplace = 0;
                let countCaps = 0;

                // 1. USER REPLACEMENTS
                if (mode.pairs && mode.pairs.length > 0) {
                    const rules = mode.pairs
                        .filter(p => p.find && p.find !== '')
                        .map(p => ({ find: normalizeInput(p.find), replace: normalizeInput(p.replace || '') }))
                        .sort((a,b) => b.find.length - a.find.length);

                    rules.forEach(rule => {
                        const pattern = escapeRegExp(rule.find);
                        const flags = mode.matchCase ? 'g' : 'gi';
                        let regex;
                        if (mode.wholeWord) {
                            const startIsWord = /[\p{L}\p{N}_]/u.test(rule.find[0]);
                            const endIsWord = /[\p{L}\p{N}_]/u.test(rule.find[rule.find.length-1]);
                            const leftBound = startIsWord ? '(?<![\\p{L}\\p{N}_])' : '';
                            const rightBound = endIsWord ? '(?![\\p{L}\\p{N}_])' : '';
                            regex = new RegExp(`${leftBound}${pattern}${rightBound}`, flags + 'u');
                        } else {
                            regex = new RegExp(pattern, flags);
                        }
                        
                        processedText = processedText.replace(regex, (match) => {
                            countReplace++; 
                            let replacement = rule.replace;
                            if (!mode.matchCase && rule.replace.length > 0) replacement = preserveCase(match, replacement);
                            return `${MARK_REP_START}${replacement}${MARK_REP_END}`;
                        });
                    });
                }

                // 2. ABNORMAL CAPS
                if (state.abnormalCapsMode > 0) {
                    const abnormalRegex = /(?<=[\p{Ll},;]\s+)([\p{Lu}][\p{Ll}]+)(?!\s+[\p{Lu}])(?=\s+[\p{Ll}\p{P}]|[\p{P}])/gum;
                    
                    if (state.abnormalCapsMode == 1) { 
                        processedText = processedText.replace(abnormalRegex, (match, p1) => p1.toLowerCase());
                    } else if (state.abnormalCapsMode == 2) {
                        const mode2Regex = /(?<=[\p{Ll},;]\s+)([\p{Lu}][\p{Ll}]+)(\s+)([\p{Ll}]+)/gum;
                        processedText = processedText.replace(mode2Regex, (match, word1, space, word2) => {
                            return `${word1}${space}${word2.charAt(0).toUpperCase() + word2.slice(1)}`;
                        });
                    }
                }

                // 3. AUTO CAPS
                if (mode.autoCaps) {
                    const autoCapsRegex = /(?:(^)|([.?!]|\.\.\.)\s+|:\s*["“]\s*)(?:(\uE000.*?\uE001)|([\p{Ll}]))/gmu;
                    processedText = processedText.replace(autoCapsRegex, (match, startLine, punct, markGroup, lowerChar) => {
                        if (markGroup) {
                            return match.replace(MARK_REP_START, MARK_BOTH_START).replace(MARK_REP_END, MARK_BOTH_END);
                        }
                        if (lowerChar) {
                            const capped = lowerChar.toUpperCase();
                            countCaps++;
                            return match.slice(0, -lowerChar.length) + `${MARK_CAP_START}${capped}${MARK_CAP_END}`;
                        }
                        return match;
                    });
                }

                // 4. FORMAT DIALOGUE & SPACING
                processedText = formatDialogue(processedText, state.dialogueMode);
                processedText = processedText.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '').join('\n\n');

                // 5. RENDER HTML
                let finalHTML = ''; let buffer = '';
                for (let i = 0; i < processedText.length; i++) {
                    const c = processedText[i];
                    if (c === MARK_REP_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-yellow">'; buffer = ''; }
                    else if (c === MARK_REP_END || c === MARK_CAP_END || c === MARK_BOTH_END) { finalHTML += escapeHTML(buffer) + '</mark>'; buffer = ''; }
                    else if (c === MARK_CAP_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-blue">'; buffer = ''; }
                    else if (c === MARK_BOTH_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-orange">'; buffer = ''; }
                    else { buffer += c; }
                }
                finalHTML += escapeHTML(buffer);

                els.outputText.innerHTML = finalHTML;
                els.replaceCountBadge.textContent = `Replace: ${countReplace}`;
                els.capsCountBadge.textContent = `Auto-Caps: ${countCaps}`;
                updateCounters();
                
                els.inputText.value = ''; saveTempInput();
                showInlineNotify(els.replaceBtn, "Hoàn tất!");
            } catch (e) { console.error(e); showNotification("Lỗi: " + e.message, "error"); }
        });
    }

    // =========================================================================
    // 4. SPLIT LOGIC
    // =========================================================================
    function updateSplitUI() {
        const isRegex = document.querySelector('input[name="split-type"][value="regex"]').checked;
        els.splitControlCount.classList.toggle('hidden', isRegex);
        els.splitControlRegex.classList.toggle('hidden', !isRegex);
        els.splitWrapper.innerHTML = '';
        if (!isRegex) renderSplitPlaceholders(currentSplitMode);
    }

    function renderSplitPlaceholders(count) {
        els.splitWrapper.innerHTML = ''; 
        for (let i = 1; i <= count; i++) {
             const div = document.createElement('div'); div.className = 'split-box';
             div.innerHTML = `
                <div class="split-header"><span>Phần ${i}</span><span class="badge green">0 Words</span></div>
                <textarea id="out-split-${i-1}" class="custom-scrollbar" readonly placeholder="Kết quả..."></textarea>
                <div class="split-footer"><button type="button" class="btn btn-success full-width copy-split-btn" data-target="out-split-${i-1}">Sao chép</button></div>
            `;
            els.splitWrapper.appendChild(div);
        }
        bindCopyEvents();
    }

    function performSplit() {
        const text = els.splitInput.value;
        if(!text.trim()) { showInlineNotify(els.splitActionBtn, "Trống!"); return; }
        const splitType = document.querySelector('input[name="split-type"]:checked').value;

        let parts = [];
        if (splitType === 'regex') {
            let regex;
            try {
                if (state.regexMode === 'custom') regex = new RegExp(state.customRegex, 'gmi');
                else if (state.regexMode === 'book') regex = /(?:Hồi|Quyển)\s+(?:\d+|[IVXLCDM]+)(?:[:.-]\s*.*)?/gi;
                else regex = /(?:Chương|Chapter)\s+\d+(?:[:.-]\s*.*)?/gi;
            } catch (e) { showInlineNotify(els.splitActionBtn, "Lỗi Regex!"); return; }

            const matches = [...text.matchAll(regex)];
            if (matches.length === 0) { showInlineNotify(els.splitActionBtn, "Không tìm thấy chương!"); return; }
            
            for (let i = 0; i < matches.length; i++) {
                const start = matches[i].index;
                const end = (i < matches.length - 1) ? matches[i+1].index : text.length;
                let chunk = text.substring(start, end).trim().split(/\r?\n/).filter(l => l.trim()).join('\n\n');
                const title = chunk.split('\n')[0].trim();
                parts.push({ content: chunk, title: title || `Phần ${i+1}` });
            }
        } else {
            // Count Logic
            const lines = normalizeInput(text).split('\n');
            let chapterHeader = '', contentBody = normalizeInput(text);
            if (/^(Chương|Chapter|Hồi)\s+\d+/.test(lines[0].trim())) { 
                chapterHeader = lines[0].trim(); 
                contentBody = lines.slice(1).join('\n'); 
            }
            
            const paragraphs = contentBody.split('\n').filter(p => p.trim());
            const targetWords = Math.ceil(countWords(contentBody) / currentSplitMode);
            
            let currentPart = [], currentCount = 0, rawParts = [];
            for (let p of paragraphs) {
                const wCount = countWords(p);
                if (currentCount + wCount > targetWords && rawParts.length < currentSplitMode - 1) { 
                    rawParts.push(currentPart.join('\n\n')); 
                    currentPart = [p]; currentCount = wCount; 
                } else { currentPart.push(p); currentCount += wCount; }
            }
            if (currentPart.length) rawParts.push(currentPart.join('\n\n'));
            
            parts = rawParts.map((p, i) => ({
                content: (chapterHeader ? chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i+1}`) + '\n\n' : '') + p,
                title: chapterHeader ? `Phần ${i+1}` : `Phần ${i+1}`
            }));
        }
        
        els.splitWrapper.innerHTML = '';
        parts.forEach((part, index) => {
            const div = document.createElement('div'); div.className = 'split-box';
            div.innerHTML = `
                <div class="split-header"><span>${part.title.substring(0,25)}...</span><span class="badge green">${countWords(part.content)} Words</span></div>
                <textarea id="out-split-${index}" class="custom-scrollbar" readonly>${part.content}</textarea>
                <div class="split-footer"><button type="button" class="btn btn-success full-width copy-split-btn" data-target="out-split-${index}">Sao chép</button></div>`;
            els.splitWrapper.appendChild(div);
        });
        bindCopyEvents();
        showInlineNotify(els.splitActionBtn, `Đã chia ${parts.length} phần!`);
        els.splitInput.value = ''; saveTempInput();
    }

    function bindCopyEvents() {
        els.splitWrapper.querySelectorAll('.copy-split-btn').forEach(b => {
            b.onclick = (e) => {
                e.preventDefault();
                const el = document.getElementById(e.target.dataset.target);
                if(el && el.value) { 
                    navigator.clipboard.writeText(el.value); 
                    showInlineNotify(e.target, "Đã chép!");
                }
            };
        });
    }

    // =========================================================================
    // 5. UI & EVENTS
    // =========================================================================
    
    function renderModeSelect() {
      els.modeSelect.innerHTML = '';
      Object.keys(state.modes).sort().forEach(m => {
        const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
        els.modeSelect.appendChild(opt);
      });
      els.modeSelect.value = state.currentMode;
      updateModeUI();
    }
  
    function updateModeUI() {
      const mode = state.modes[state.currentMode];
      if(mode) {
          const upd = (btn, act) => act ? btn.classList.add('active') : btn.classList.remove('active');
          upd(els.matchCaseBtn, mode.matchCase);
          upd(els.wholeWordBtn, mode.wholeWord);
          upd(els.autoCapsBtn, mode.autoCaps);
      }
      els.formatCards.forEach(card => card.classList.toggle('active', parseInt(card.dataset.format) === state.dialogueMode));
      els.abCapsCards.forEach(card => card.classList.toggle('active', parseInt(card.dataset.abCaps) === state.abnormalCapsMode));
      
      const regexInput = document.querySelector(`input[name="regex-preset"][value="${state.regexMode}"]`);
      if(regexInput) regexInput.checked = true;
      els.customRegexInput.value = state.customRegex || '';
    }
  
    function renderList() {
        els.list.innerHTML = '';
        const mode = state.modes[state.currentMode];
        const fragment = document.createDocumentFragment();
        
        mode.pairs.forEach((p, realIndex) => {
            const item = document.createElement('div'); item.className = 'punctuation-item';
            item.innerHTML = `
                <div class="index-label">${realIndex + 1}</div>
                <input type="text" class="find" placeholder="Tìm" value="${p.find.replace(/"/g, '&quot;')}">
                <input type="text" class="replace" placeholder="Thay thế" value="${(p.replace||'').replace(/"/g, '&quot;')}">
                <button type="button" class="remove" tabindex="-1">×</button>
            `;
            const inputs = item.querySelectorAll('input');
            inputs[0].oninput = (e) => { p.find = e.target.value; };
            inputs[1].oninput = (e) => { p.replace = e.target.value; };
            
            item.querySelector('.remove').onclick = (e) => { 
                e.preventDefault();
                mode.pairs.splice(realIndex, 1); 
                renderList(); 
            };
            fragment.appendChild(item);
        });
        els.list.appendChild(fragment);
        
        // ĐÃ FIX: Giờ els.emptyState đã tồn tại, không còn lỗi undefined
        if (els.emptyState) {
            els.emptyState.classList.toggle('hidden', mode.pairs.length > 0);
        }
    }

    // CSV LOGIC
    function importCSV(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            if(lines.length < 1) return;

            const firstLine = lines[0];
            const delimiter = firstLine.includes('\t') ? '\t' : ',';
            
            let count = 0;
            for(let i = 1; i < lines.length; i++) {
                let cols;
                if (delimiter === '\t') {
                    cols = lines[i].split('\t').map(c => c.trim());
                } else {
                    // Xử lý CSV cơ bản (chấp nhận phẩy)
                    cols = lines[i].split(',').map(c => c.trim()); 
                }

                if(cols.length >= 2) {
                    const find = cols[1];
                    const replace = cols[2] || '';
                    const modeName = cols[3] || 'default';
                    
                    if(find) {
                        if(!state.modes[modeName]) {
                             state.modes[modeName] = JSON.parse(JSON.stringify(defaultState.modes.default));
                        }
                        state.modes[modeName].pairs.push({ find, replace });
                        count++;
                    }
                }
            }
            saveState(); renderModeSelect(); renderList();
            showNotification(`Đã nhập ${count} cặp từ!`);
        };
        reader.readAsText(file);
    }
    
    function updateCounters() {
      els.inputCount.textContent = countWords(els.inputText.value) + ' Words';
      els.outputCount.textContent = countWords(els.outputText.innerText) + ' Words';
      els.splitInputCount.textContent = countWords(els.splitInput.value) + ' Words';
    }
    function saveTempInput() { localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({ inputText: els.inputText.value, splitInput: els.splitInput.value })); }
    function loadTempInput() {
      const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY));
      if(saved) { els.inputText.value = saved.inputText || ''; els.splitInput.value = saved.splitInput || ''; }
      updateCounters();
    }
    function switchTab(tabId) {
        els.tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
        state.activeTab = tabId; saveState();
        if(tabId === 'split') updateSplitUI();
    }
    function switchSidebar(targetId) {
        els.sidebarBtns.forEach(b => b.classList.toggle('active', b.dataset.target === targetId));
        els.settingPanels.forEach(p => p.classList.toggle('active', p.id === targetId));
    }

    function initEvents() {
      els.tabButtons.forEach(btn => btn.onclick = (e) => { e.preventDefault(); switchTab(btn.dataset.tab); });
      els.sidebarBtns.forEach(btn => btn.onclick = (e) => { e.preventDefault(); switchSidebar(btn.dataset.target); });

      const toggleHandler = (prop) => { 
          const m = state.modes[state.currentMode]; 
          m[prop] = !m[prop]; 
          updateModeUI(); 
      };
      els.matchCaseBtn.onclick = (e) => { e.preventDefault(); toggleHandler('matchCase'); };
      els.wholeWordBtn.onclick = (e) => { e.preventDefault(); toggleHandler('wholeWord'); };
      els.autoCapsBtn.onclick = (e) => { e.preventDefault(); toggleHandler('autoCaps'); };
      
      els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; renderList(); updateModeUI(); };
      
      document.getElementById('add-mode').onclick = (e) => { 
          e.preventDefault(); const n = prompt('Tên Mode mới:'); 
          if(n && !state.modes[n]) { state.modes[n] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }; state.currentMode = n; saveState(); renderModeSelect(); renderList(); }
      };
      document.getElementById('rename-mode').onclick = (e) => {
          e.preventDefault(); const n = prompt('Tên mới:', state.currentMode);
          if(n && n!==state.currentMode && !state.modes[n]){ state.modes[n]=state.modes[state.currentMode]; delete state.modes[state.currentMode]; state.currentMode=n; saveState(); renderModeSelect(); }
      };
      document.getElementById('delete-mode').onclick = (e) => {
          e.preventDefault(); if(confirm('Xóa?')) { delete state.modes[state.currentMode]; const k=Object.keys(state.modes); state.currentMode=k.length?k[0]:'default'; if(!k.length) state.modes.default=defaultState.modes.default; saveState(); renderModeSelect(); renderList(); }
      };

      document.getElementById('add-pair').onclick = (e) => { 
          e.preventDefault(); 
          state.modes[state.currentMode].pairs.unshift({ find: '', replace: '' }); 
          renderList(); 
          if(els.list.firstChild) els.list.firstChild.querySelector('.find').focus();
      };
      document.getElementById('save-settings').onclick = (e) => { e.preventDefault(); saveState(); showNotification('Đã lưu cài đặt!'); };
      document.getElementById('export-settings').onclick = (e) => { e.preventDefault(); /* Logic export cũ */ };
      document.getElementById('import-settings').onclick = (e) => { e.preventDefault(); const inp=document.createElement('input'); inp.type='file'; inp.accept='.csv'; inp.onchange=e=>{if(e.target.files.length) importCSV(e.target.files[0])}; inp.click(); };
      
      els.replaceBtn.onclick = (e) => { e.preventDefault(); performReplaceAll(); };
      els.copyBtn.onclick = (e) => { 
          e.preventDefault(); 
          if(els.outputText.innerText) { navigator.clipboard.writeText(els.outputText.innerText); showInlineNotify(els.copyBtn, 'Đã chép!'); }
      };

      els.formatCards.forEach(card => card.onclick = () => { state.dialogueMode = parseInt(card.dataset.format); saveState(); updateModeUI(); });
      els.abCapsCards.forEach(card => card.onclick = () => { state.abnormalCapsMode = parseInt(card.dataset.abCaps); saveState(); updateModeUI(); });
      
      els.saveRegexBtn.onclick = (e) => { e.preventDefault(); state.regexMode = document.querySelector('input[name="regex-preset"]:checked').value; state.customRegex = els.customRegexInput.value; saveState(); showInlineNotify(els.saveRegexBtn, "Đã Lưu!"); };

      els.splitTypeRadios.forEach(r => r.addEventListener('change', updateSplitUI));
      document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = (e) => { 
          e.preventDefault(); document.querySelectorAll('.split-mode-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); currentSplitMode=parseInt(btn.dataset.split); if(!document.querySelector('input[value="regex"]').checked) renderSplitPlaceholders(currentSplitMode);
      });
      els.splitActionBtn.onclick = (e) => { e.preventDefault(); performSplit(); };
      [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { updateCounters(); clearTimeout(saveTimeout); saveTimeout=setTimeout(saveTempInput, 1000); }));
    }

    renderModeSelect(); renderList(); loadTempInput(); if(state.activeTab) switchTab(state.activeTab); updateSplitUI(); initEvents();
});
