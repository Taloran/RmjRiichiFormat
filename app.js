(() => {
  const EXPECTED_TOTAL = 1000;
  const TOKEN_REGEX = /-?\d+|[\u4e00-\u9fa5A-Za-z0-9_\u00B7\-]+/g;
  const STORAGE_KEY = "rmj-alias-config";
  const ANNOUNCEMENT_STORAGE_KEY = "rmj-announcement-dismissed-v1";

  const state = {
    aliasMap: new Map(),
    suppressAliasSave: false,
    announcementDismissed: false,
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    bindEvents();
    loadAliasConfig();
    ensureAliasRow();
    updateAliasSummary();
    initAnnouncementOverlay();
    updateStatus("\u51c6\u5907\u5c31\u7eea\u3002");
  }

  function cacheDom() {
    dom.announcementOverlay = document.getElementById("announcement-overlay");
    dom.announcementCloseBtn = document.getElementById(
      "announcement-close-btn"
    );
    dom.announcementRemember = document.getElementById(
      "announcement-dismiss-remember"
    );
    dom.rawInput = document.getElementById("raw-input");
    dom.processBtn = document.getElementById("process-btn");
    dom.clearBtn = document.getElementById("clear-btn");
    dom.outputArea = document.getElementById("output-area");
    dom.plainOutput = document.getElementById("plain-output");
    dom.statusBar = document.getElementById("status-bar");
    dom.aliasTableBody = document.getElementById("alias-table-body");
    dom.aliasTableWrapper = document.getElementById("alias-table-wrapper");
    dom.aliasCountLabel = document.getElementById("alias-count-label");
    dom.addAliasBtn = document.getElementById("add-alias-btn");
    dom.importAliasBtn = document.getElementById("import-alias-btn");
    dom.exportAliasBtn = document.getElementById("export-alias-btn");
    dom.aliasFileInput = document.getElementById("alias-file-input");
    dom.copyPlainBtn = document.getElementById("copy-plain-btn");
    dom.toggleAliasBtn = document.getElementById("toggle-alias-btn");
  }

  function bindEvents() {
    if (dom.announcementCloseBtn) {
      dom.announcementCloseBtn.addEventListener(
        "click",
        handleAnnouncementClose
      );
    }
    dom.processBtn.addEventListener("click", processInput);
    dom.clearBtn.addEventListener("click", clearInput);
    dom.addAliasBtn.addEventListener("click", () => addAliasRow());
    dom.importAliasBtn.addEventListener("click", () =>
      dom.aliasFileInput.click()
    );
    dom.aliasFileInput.addEventListener("change", handleAliasImport);
    dom.exportAliasBtn.addEventListener("click", exportAliasConfig);
    dom.aliasTableBody.addEventListener("input", syncAliasMap);
    dom.aliasTableBody.addEventListener("click", handleAliasTableClick);
    dom.copyPlainBtn.addEventListener("click", copyPlainOutput);
    if (dom.toggleAliasBtn) {
      dom.toggleAliasBtn.addEventListener("click", toggleAliasPanel);
    }
    document.addEventListener("keydown", handleShortcut);
  }

  function ensureAliasRow() {
    if (dom.aliasTableBody.children.length === 0) {
      withAliasSaveSuppressed(() => {
        addAliasRow("", "", { skipSync: true });
        syncAliasMap();
      });
    }
  }

  function addAliasRow(alias = "", target = "", options = {}) {
    const row = document.createElement("tr");

    const aliasCell = document.createElement("td");
    const aliasInput = document.createElement("input");
    aliasInput.type = "text";
    aliasInput.className = "alias-from";
    aliasInput.placeholder = "\u539f\u540d";
    aliasInput.value = alias;
    aliasCell.appendChild(aliasInput);
    row.appendChild(aliasCell);

    const targetCell = document.createElement("td");
    const targetInput = document.createElement("input");
    targetInput.type = "text";
    targetInput.className = "alias-to";
    targetInput.placeholder = "\u663e\u793a\u540d";
    targetInput.value = target;
    targetCell.appendChild(targetInput);
    row.appendChild(targetCell);

    const controlCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "alias-delete-btn";
    deleteButton.setAttribute("aria-label", "\u5220\u9664\u6b64\u522b\u540d");
    deleteButton.title = "\u5220\u9664\u6b64\u522b\u540d";
    deleteButton.textContent = "\u00d7";
    controlCell.appendChild(deleteButton);
    row.appendChild(controlCell);

    dom.aliasTableBody.appendChild(row);

    if (!options.skipSync) {
      syncAliasMap();
    }
  }

  function handleAliasTableClick(event) {
    if (!event.target.classList.contains("alias-delete-btn")) {
      return;
    }
    const row = event.target.closest("tr");
    if (row) {
      row.remove();
      syncAliasMap();
      ensureAliasRow();
    }
  }

  function syncAliasMap() {
    state.aliasMap.clear();
    const rows = dom.aliasTableBody.querySelectorAll("tr");
    rows.forEach((row) => {
      const alias = row.querySelector(".alias-from")?.value.trim();
      const target = row.querySelector(".alias-to")?.value.trim();
      if (alias && target) {
        state.aliasMap.set(alias, target);
      }
    });
    if (!state.suppressAliasSave) {
      saveAliasConfig();
    }
    updateAliasSummary();
  }

  function updateAliasSummary() {
    const total = state.aliasMap.size;
    if (dom.aliasCountLabel) {
      dom.aliasCountLabel.textContent = `\u5171 ${total} \u6761`;
    }
    if (dom.toggleAliasBtn) {
      const isCollapsed =
        dom.aliasTableWrapper?.classList.contains("collapsed");
      dom.toggleAliasBtn.textContent = isCollapsed
        ? "\u5c55\u5f00\u5217\u8868"
        : "\u6298\u53e0\u5217\u8868";
      dom.toggleAliasBtn.setAttribute(
        "aria-expanded",
        isCollapsed ? "false" : "true"
      );
      if (dom.aliasTableWrapper) {
        dom.aliasTableWrapper.setAttribute(
          "aria-hidden",
          isCollapsed ? "true" : "false"
        );
      }
    }
  }

  function toggleAliasPanel() {
    if (!dom.aliasTableWrapper) {
      return;
    }
    dom.aliasTableWrapper.classList.toggle("collapsed");
    updateAliasSummary();
  }

  function processInput() {
    syncAliasMap();
    // 预处理：识别跨行的 [[...]] 标记并合并成单个处理单元
    const rawText = dom.rawInput.value;
    const processedLines = [];
    const passthroughBlocks = [];

    // 提取所有 [[...]] 块（包括跨行的）
    let lastIndex = 0;
    const passthroughRegex = /\[\[([^\[\]]+?)\]\]/gs;
    let match;

    while ((match = passthroughRegex.exec(rawText)) !== null) {
      // 添加 [[...]] 之前的普通文本
      const beforeText = rawText.slice(lastIndex, match.index);
      if (beforeText.trim()) {
        processedLines.push(...beforeText.split(/\r?\n/));
      }

      // 保存 [[...]] 块，用占位符代替
      const placeholder = `__PASSTHROUGH_${passthroughBlocks.length}__`;
      passthroughBlocks.push(match[1]); // 保存内容（包含换行符）
      processedLines.push(placeholder);

      lastIndex = passthroughRegex.lastIndex;
    }

    // 添加最后剩余的文本
    const remainingText = rawText.slice(lastIndex);
    if (remainingText.trim()) {
      processedLines.push(...remainingText.split(/\r?\n/));
    }

    const plainLines = [];
    dom.outputArea.innerHTML = "";

    const stats = {
      processed: 0,
      formatErrors: 0,
      totalErrors: 0,
      aliasReplacements: 0,
    };

    processedLines.forEach((rawLine, index) => {
      if (!rawLine.trim()) {
        return;
      }
      const lineNumber = index + 1;
      const result = parseLine(rawLine, lineNumber, passthroughBlocks);
      stats.processed += 1;
      stats.aliasReplacements += result.aliasReplacements ?? 0;
      if (result.type === "format-error") {
        stats.formatErrors += 1;
      } else if (result.type === "total-error") {
        stats.totalErrors += 1;
      }
      dom.outputArea.appendChild(result.element);
      if (result.plainLines?.length) {
        plainLines.push(...result.plainLines);
      }
    });

    dom.plainOutput.value = plainLines.join("\n");

    if (stats.processed === 0) {
      updateStatus(
        "\u6ca1\u6709\u53ef\u5904\u7406\u7684\u5185\u5bb9\uff0c\u8bf7\u8f93\u5165\u81f3\u5c11\u4e00\u884c\u6570\u636e\u3002",
        "warning"
      );
      return;
    }

    const summary = [`\u5904\u7406 ${stats.processed} \u884c`];
    if (stats.aliasReplacements > 0) {
      summary.push(
        `\u522b\u540d\u66ff\u6362 ${stats.aliasReplacements} \u6b21`
      );
    }
    if (stats.formatErrors > 0) {
      summary.push(`\u683c\u5f0f\u5f02\u5e38 ${stats.formatErrors} \u884c`);
    }
    if (stats.totalErrors > 0) {
      summary.push(`\u603b\u5206\u5f02\u5e38 ${stats.totalErrors} \u884c`);
    }

    let statusType = "";
    if (stats.formatErrors > 0) {
      statusType = "warning";
    }
    if (stats.totalErrors > 0) {
      statusType = "error";
    }

    updateStatus(`${summary.join("\uff0c")}\u3002`, statusType);
    dom.outputArea.scrollTop = 0;
  }

  function parseLine(rawLine, lineNumber, passthroughBlocks = []) {
    // 检测是否为占位符（来自跨行的 [[...]]）
    const placeholderMatch = /^__PASSTHROUGH_(\d+)__$/.exec(rawLine.trim());
    if (placeholderMatch) {
      const blockIndex = parseInt(placeholderMatch[1], 10);
      const content = passthroughBlocks[blockIndex];
      if (content != null) {
        // 处理内容：保留换行符，但删除每行的多余空格
        const lines = content
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+/g, " ").trim());
        const processedContent = lines.join("\n");
        return {
          type: "passthrough",
          aliasReplacements: 0,
          plainLines: lines,
          element: createPassthroughBlock(lineNumber, processedContent),
        };
      }
    }

    // 检测是否为原样输出标记 [[...]]（单行情况）
    const passthroughMatch = /^\[\[(.+)\]\]$/.exec(rawLine.trim());
    if (passthroughMatch) {
      const content = passthroughMatch[1].replace(/\s+/g, " ").trim();
      return {
        type: "passthrough",
        aliasReplacements: 0,
        plainLines: [content],
        element: createPassthroughBlock(lineNumber, content),
      };
    }

    const { processedLine, forcedNames } = preprocessForcedNames(rawLine);
    const normalized = normalizeLine(processedLine);
    if (!normalized) {
      return {
        type: "format-error",
        aliasReplacements: 0,
        plainLines: [],
        element: createFormatErrorBlock(
          lineNumber,
          rawLine,
          "\u8be5\u884c\u4e3a\u7a7a\u6216\u4ec5\u5305\u542b\u7a7a\u767d\u5b57\u7b26\u3002"
        ),
      };
    }

    const extraction = extractPairs(normalized, forcedNames);
    if (!extraction.success) {
      return {
        type: "format-error",
        aliasReplacements: 0,
        plainLines: [],
        element: createFormatErrorBlock(lineNumber, rawLine, extraction.error),
      };
    }

    const aliasDetails = extraction.pairs.map(({ name }) => {
      const trimmed = name.trim();
      if (state.aliasMap.has(trimmed)) {
        const mapped = state.aliasMap.get(trimmed) ?? trimmed;
        return {
          original: trimmed,
          display: mapped,
          replaced: mapped !== trimmed,
        };
      }
      return {
        original: trimmed,
        display: trimmed,
        replaced: false,
      };
    });

    const scores = extraction.pairs.map(({ score }) => score);
    const total = scores.reduce((sum, value) => sum + value, 0);
    const aliasReplacements = aliasDetails.filter(
      (detail) => detail.replaced
    ).length;
    const plainLines = [
      aliasDetails.map((detail) => detail.display).join(" "),
      scores.map((value) => String(value)).join(" "),
    ];

    const block = createRecordBlock({
      lineNumber,
      aliasDetails,
      scores,
      total,
      aliasCount: aliasReplacements,
    });

    if (total !== EXPECTED_TOTAL) {
      block.classList.add("error-total");
      return {
        type: "total-error",
        aliasReplacements,
        plainLines,
        element: block,
      };
    }

    return {
      type: "ok",
      aliasReplacements,
      plainLines,
      element: block,
    };
  }

  function preprocessForcedNames(line) {
    const forcedEntries = [];
    const processedLine = line.replace(/\{\{([^{}]+)\}\}/g, (_, captured) => {
      const index = forcedEntries.length;
      forcedEntries.push(captured);
      const token = createForcedToken(index);
      return token;
    });
    return { processedLine, forcedNames: forcedEntries };
  }

  function restoreForcedName(name, forcedNames) {
    const match = /^FORCED([A-Z]+)MARK$/.exec(name);
    if (!match) {
      return name;
    }
    const decoded = decodeForcedToken(match[1]);
    return forcedNames[decoded] ?? name;
  }

  function createForcedToken(index) {
    let num = index;
    let result = "";
    do {
      result = String.fromCharCode(65 + (num % 26)) + result;
      num = Math.floor(num / 26) - 1;
    } while (num >= 0);
    return `FORCED${result}MARK`;
  }

  function decodeForcedToken(letters) {
    let value = 0;
    for (let i = 0; i < letters.length; i += 1) {
      value = value * 26 + (letters.charCodeAt(i) - 65 + 1);
    }
    return value - 1;
  }

  function mapForcedPairs(pairs, forcedNames) {
    return pairs.map(({ name, score }) => ({
      name: restoreForcedName(name, forcedNames),
      score,
    }));
  }

  function normalizeLine(line) {
    return line.replace(/\s+/g, " ").trim();
  }

  function extractPairs(line, forcedNames = []) {
    const initialTokens = [];
    TOKEN_REGEX.lastIndex = 0;
    let match;
    while ((match = TOKEN_REGEX.exec(line)) !== null) {
      initialTokens.push(createToken(match[0]));
    }

    const separatedFromInitial = collectSeparatedPairs(initialTokens);
    if (separatedFromInitial) {
      return {
        success: true,
        pairs: mapForcedPairs(separatedFromInitial, forcedNames),
      };
    }

    const adjustedTokens = adjustNegativeMarkers(initialTokens);
    let pairs = resolvePairs(adjustedTokens, 0, 0);
    if (!pairs) {
      const separatedAfterAdjust = collectSeparatedPairs(adjustedTokens);
      if (separatedAfterAdjust) {
        return {
          success: true,
          pairs: mapForcedPairs(separatedAfterAdjust, forcedNames),
        };
      }
      const expanded = expandCompositeTokens(adjustedTokens);
      if (expanded.changed) {
        const readjusted = adjustNegativeMarkers(expanded.tokens);
        pairs = resolvePairs(readjusted, 0, 0);
        if (!pairs) {
          const separatedAfterExpand = collectSeparatedPairs(readjusted);
          if (separatedAfterExpand) {
            return {
              success: true,
              pairs: mapForcedPairs(separatedAfterExpand, forcedNames),
            };
          }
        }
      }
    }
    if (!pairs) {
      const compactResult = extractFromCompactText(line);
      if (!compactResult.success) {
        return compactResult;
      }
      return {
        success: true,
        pairs: mapForcedPairs(compactResult.pairs, forcedNames),
      };
    }
    return {
      success: true,
      pairs: mapForcedPairs(pairs, forcedNames),
    };
  }

  function createToken(value) {
    return {
      value,
      isNumber: /^-?\d+$/.test(value),
    };
  }

  function adjustNegativeMarkers(tokens) {
    const adjusted = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (
        !token.isNumber &&
        token.value.endsWith("-") &&
        index + 1 < tokens.length
      ) {
        const base = token.value.slice(0, -1).trim();
        const candidate = tokens[index + 1];
        if (candidate.isNumber) {
          const numeric = Number.parseInt(candidate.value, 10);
          if (!Number.isNaN(numeric)) {
            if (base) {
              adjusted.push(createToken(base));
            }
            adjusted.push(createToken(String(-Math.abs(numeric))));
            index += 1;
            continue;
          }
        }
      }
      adjusted.push(createToken(token.value));
    }
    return adjusted;
  }

  function expandCompositeTokens(tokens) {
    const expanded = [];
    let changed = false;
    const trailingNumberRegex = /^([\u4e00-\u9fa5A-Za-z_\u00B7\-]+?)(-?\d+)$/;

    tokens.forEach((token) => {
      if (!token.isNumber) {
        const match = token.value.match(trailingNumberRegex);
        if (match) {
          expanded.push(createToken(match[1]));
          expanded.push(createToken(match[2]));
          changed = true;
          return;
        }
      }
      expanded.push(createToken(token.value));
    });

    return {
      tokens: expanded,
      changed,
    };
  }

  function extractFromCompactText(line) {
    const compact = line.replace(/\s+/g, "");
    const regex = /([\u4e00-\u9fa5A-Za-z_\u00B7]+)(-?\d+)/g;
    const pairs = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(compact)) !== null) {
      if (match.index !== lastIndex) {
        return {
          success: false,
          error:
            "\u65e0\u6cd5\u8bc6\u522b 4 \u4e2a\u201c\u540d\u5b57 + \u5206\u6570\u201d\u7ec4\u5408\uff0c\u8bf7\u8865\u5145\u5206\u9694\u7b26\u540e\u91cd\u8bd5\u3002",
        };
      }
      const score = Number.parseInt(match[2], 10);
      if (Number.isNaN(score)) {
        return {
          success: false,
          error:
            "\u7d27\u51d1\u683c\u5f0f\u5305\u542b\u65e0\u6cd5\u89e3\u6790\u7684\u5206\u6570\u3002",
        };
      }
      pairs.push({ name: match[1], score });
      lastIndex = regex.lastIndex;
    }

    if (pairs.length === 4 && lastIndex === compact.length) {
      return {
        success: true,
        pairs,
      };
    }

    return {
      success: false,
      error:
        "\u65e0\u6cd5\u8bc6\u522b 4 \u4e2a\u201c\u540d\u5b57 + \u5206\u6570\u201d\u7ec4\u5408\uff0c\u8bf7\u8865\u5145\u5206\u9694\u7b26\u540e\u91cd\u8bd5\u3002",
    };
  }

  function collectSeparatedPairs(tokens) {
    const names = [];
    const scores = [];
    let index = 0;

    while (index < tokens.length && !tokens[index].isNumber) {
      if (tokens[index].value.trim()) {
        names.push(tokens[index].value);
      }
      index += 1;
    }

    while (index < tokens.length && tokens[index].isNumber) {
      const numeric = Number.parseInt(tokens[index].value, 10);
      if (Number.isNaN(numeric)) {
        return null;
      }
      scores.push(numeric);
      index += 1;
    }

    if (names.length === 4 && scores.length === 4 && index === tokens.length) {
      return names.map((name, i) => {
        let finalName = name;
        let finalScore = scores[i];
        if (finalName.endsWith("-")) {
          finalName = finalName.slice(0, -1).trim();
          finalScore = -Math.abs(finalScore);
        }
        return {
          name: finalName,
          score: finalScore,
        };
      });
    }
    return null;
  }

  function resolvePairs(tokens, startIndex, pairIndex) {
    if (pairIndex === 4) {
      for (let i = startIndex; i < tokens.length; i += 1) {
        if (tokens[i].value.trim()) {
          return null;
        }
      }
      return [];
    }

    let name = "";
    let index = startIndex;
    let hasName = false;

    while (index < tokens.length) {
      const token = tokens[index];
      if (!token.isNumber) {
        name += token.value;
        hasName = true;
        index += 1;
        continue;
      }

      if (!hasName) {
        return null;
      }

      const score = Number.parseInt(token.value, 10);
      if (Number.isNaN(score)) {
        return null;
      }

      const remainder = resolvePairs(tokens, index + 1, pairIndex + 1);
      if (remainder) {
        return [{ name, score }, ...remainder];
      }

      name += token.value;
      index += 1;
    }

    return null;
  }

  function createRecordBlock({
    lineNumber,
    aliasDetails,
    scores,
    total,
    aliasCount,
  }) {
    const block = document.createElement("div");
    block.className = "record-block";

    const header = document.createElement("div");
    header.className = "record-header";
    header.appendChild(createLineBadge(lineNumber));
    if (aliasCount > 0) {
      header.appendChild(
        createStatusTag(`\u522b\u540d \u00d7${aliasCount}`, "alias")
      );
    }

    block.appendChild(header);
    block.appendChild(buildNamesPre(aliasDetails));
    block.appendChild(buildScoresPre(scores));

    if (total !== EXPECTED_TOTAL) {
      header.appendChild(createStatusTag(`\u603b\u5206 ${total}`, "alert"));
      block.appendChild(createSumWarning(total));
    }

    return block;
  }

  function createLineBadge(lineNumber) {
    const badge = document.createElement("span");
    badge.className = "line-badge";
    badge.textContent = `\u7b2c ${lineNumber} \u884c`;
    return badge;
  }

  function createStatusTag(text, type) {
    const tag = document.createElement("span");
    tag.className = "status-tag";
    if (type) {
      tag.classList.add(`status-tag--${type}`);
    }
    tag.textContent = text;
    return tag;
  }

  function buildNamesPre(aliasDetails) {
    const pre = document.createElement("pre");
    aliasDetails.forEach((detail, index) => {
      if (index > 0) {
        pre.appendChild(document.createTextNode(" "));
      }
      if (detail.replaced) {
        const span = document.createElement("span");
        span.className = "alias-highlight";
        span.textContent = detail.display;
        span.title = `\u539f\u540d\uff1a${detail.original}`;
        pre.appendChild(span);
      } else {
        pre.appendChild(document.createTextNode(detail.display));
      }
    });
    return pre;
  }

  function buildScoresPre(scores) {
    const pre = document.createElement("pre");
    pre.textContent = scores.map((score) => String(score)).join(" ");
    return pre;
  }

  function createSumWarning(total) {
    const warning = document.createElement("div");
    warning.className = "sum-warning";
    warning.textContent = `\u603b\u5206 ${total}\uff0c\u5e94\u4e3a ${EXPECTED_TOTAL}\u3002`;
    return warning;
  }

  function createFormatErrorBlock(lineNumber, rawLine, message) {
    const block = document.createElement("div");
    block.className = "record-block error-format";

    const header = document.createElement("div");
    header.className = "record-header";
    header.appendChild(createLineBadge(lineNumber));
    header.appendChild(createStatusTag("\u683c\u5f0f\u5f02\u5e38", "warning"));
    block.appendChild(header);

    const title = document.createElement("div");
    title.className = "error-title";
    title.textContent = message;
    block.appendChild(title);

    const pre = document.createElement("pre");
    pre.textContent = rawLine.trim() ? rawLine.trim() : "(\u7a7a\u884c)";
    block.appendChild(pre);

    return block;
  }

  function createPassthroughBlock(lineNumber, content) {
    const block = document.createElement("div");
    block.className = "record-block passthrough-block";

    const header = document.createElement("div");
    header.className = "record-header";
    header.appendChild(createLineBadge(lineNumber));
    header.appendChild(
      createStatusTag("\u539f\u6837\u8f93\u51fa", "passthrough")
    );
    block.appendChild(header);

    // 分割内容为多行（如果有换行符）
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      const pre = document.createElement("pre");
      pre.textContent = line;
      if (index > 0) {
        // 不是第一行，添加顶部间距
        pre.style.marginTop = "0.5rem";
      }
      block.appendChild(pre);
    });

    return block;
  }

  function clearInput() {
    dom.rawInput.value = "";
    dom.outputArea.innerHTML = "";
    if (dom.plainOutput) {
      dom.plainOutput.value = "";
    }
    updateStatus("\u8f93\u5165\u533a\u5df2\u6e05\u7a7a\u3002");
  }

  function updateStatus(message, type = "") {
    dom.statusBar.textContent = message;
    dom.statusBar.classList.remove("error", "warning");
    if (type) {
      dom.statusBar.classList.add(type);
    }
  }

  function initAnnouncementOverlay() {
    if (!dom.announcementOverlay) {
      return;
    }
    let dismissed = false;
    try {
      dismissed =
        localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) === "true";
    } catch (error) {
      console.warn("Failed to read announcement state:", error);
    }
    state.announcementDismissed = dismissed;
    if (dismissed) {
      hideAnnouncementOverlay();
    } else {
      showAnnouncementOverlay();
    }
  }

  function handleAnnouncementClose() {
    state.announcementDismissed = true;
    const remember = dom.announcementRemember?.checked ?? false;
    if (remember) {
      try {
        localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, "true");
      } catch (error) {
        console.warn("Failed to persist announcement state:", error);
      }
    } else {
      try {
        localStorage.removeItem(ANNOUNCEMENT_STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to clear announcement state:", error);
      }
    }
    hideAnnouncementOverlay();
    if (dom.rawInput) {
      dom.rawInput.focus();
    }
  }

  function hideAnnouncementOverlay() {
    if (!dom.announcementOverlay) {
      return;
    }
    dom.announcementOverlay.classList.add("hidden");
    dom.announcementOverlay.setAttribute("aria-hidden", "true");
  }

  function showAnnouncementOverlay() {
    if (!dom.announcementOverlay) {
      return;
    }
    dom.announcementOverlay.classList.remove("hidden");
    dom.announcementOverlay.setAttribute("aria-hidden", "false");
  }

  function handleAliasImport(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        applyAliasConfig(data);
        updateStatus(
          `\u6210\u529f\u5bfc\u5165\u522b\u540d\uff0c\u5171 ${state.aliasMap.size} \u6761\u3002`
        );
      } catch (error) {
        updateStatus(
          "\u522b\u540d JSON \u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u683c\u5f0f\u3002",
          "error"
        );
      } finally {
        dom.aliasFileInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function saveAliasConfig() {
    try {
      const payload = JSON.stringify(Object.fromEntries(state.aliasMap));
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (error) {
      console.warn("Failed to save alias config:", error);
    }
  }

  function loadAliasConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      applyAliasConfig(parsed);
    } catch (error) {
      console.warn("Failed to load alias config:", error);
    }
  }

  function withAliasSaveSuppressed(callback) {
    state.suppressAliasSave = true;
    try {
      callback();
    } finally {
      state.suppressAliasSave = false;
      saveAliasConfig();
    }
  }

  function applyAliasConfig(config) {
    withAliasSaveSuppressed(() => {
      dom.aliasTableBody.innerHTML = "";
      if (config && typeof config === "object") {
        Object.entries(config).forEach(([alias, target]) => {
          addAliasRow(alias, target, { skipSync: true });
        });
      }
      syncAliasMap();
      ensureAliasRow();
    });
  }

  function exportAliasConfig() {
    const obj = Object.fromEntries(state.aliasMap);
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alias-config.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    updateStatus("\u5df2\u5bfc\u51fa\u522b\u540d\u914d\u7f6e\u3002");
  }

  function copyPlainOutput() {
    const value = dom.plainOutput?.value ?? "";
    if (!value) {
      updateStatus(
        "\u6ca1\u6709\u53ef\u590d\u5236\u7684\u7eaf\u6587\u672c\u5185\u5bb9\u3002",
        "warning"
      );
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(value)
        .then(() => {
          updateStatus(
            "\u7eaf\u6587\u672c\u5df2\u590d\u5236\u5230\u526a\u5207\u677f\u3002"
          );
        })
        .catch(() => {
          fallbackCopyPlainText(value);
        });
      return;
    }

    fallbackCopyPlainText(value);
  }

  function fallbackCopyPlainText(value) {
    if (!dom.plainOutput) {
      return;
    }
    dom.plainOutput.focus();
    dom.plainOutput.select();
    const succeeded = document.execCommand("copy");
    dom.plainOutput.setSelectionRange(0, 0);
    if (succeeded) {
      updateStatus(
        "\u7eaf\u6587\u672c\u5df2\u590d\u5236\u5230\u526a\u5207\u677f\u3002"
      );
    } else {
      updateStatus(
        "\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u9009\u62e9\u540e\u590d\u5236\u3002",
        "warning"
      );
    }
  }

  function handleShortcut(event) {
    if (!event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const key = event.key || event.code;
      if (
        (key === "1" || key === "Digit1") &&
        document.activeElement === dom.rawInput
      ) {
        event.preventDefault();
        flattenInputRecords();
        return;
      }
    if (
      (key === "2" || key === "Digit2") &&
      document.activeElement === dom.rawInput
    ) {
      event.preventDefault();
      forceSelectionAsName();
      return;
    }
    if (
      (key === "3" || key === "Digit3") &&
      document.activeElement === dom.rawInput
    ) {
      event.preventDefault();
      markSelectionAsPassthrough();
    }
  }

  function forceSelectionAsName() {
    const input = dom.rawInput;
    if (!input) {
      return;
    }
    const { selectionStart, selectionEnd, value } = input;
    if (
      selectionStart == null ||
      selectionEnd == null ||
      selectionStart === selectionEnd
    ) {
      updateStatus(
        "\u8bf7\u9009\u62e9\u9700\u8981\u6807\u8bb0\u7684\u540d\u5b57\u540e\u518d\u4f7f\u7528 Ctrl+2\u3002",
        "warning"
      );
      return;
    }
    const selectedText = value.slice(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      updateStatus(
        "\u9009\u4e2d\u7684\u5185\u5bb9\u4e3a\u7a7a\u767d\uff0c\u65e0\u6cd5\u6807\u8bb0\u3002",
        "warning"
      );
      return;
    }

    const alreadyWrapped =
      selectedText.startsWith("{{") && selectedText.endsWith("}}");
    const surroundingWrapped =
      !alreadyWrapped &&
      value.lastIndexOf("{{", selectionStart) !== -1 &&
      value.indexOf("}}", selectionEnd) !== -1 &&
      value.lastIndexOf("{{", selectionStart) < selectionStart &&
      value.indexOf("}}", selectionEnd) >= selectionEnd;

    if (surroundingWrapped) {
      updateStatus(
        "\u8be5\u540d\u5b57\u5df2\u5904\u4e8e\u5f3a\u5236\u6a21\u5f0f\u3002",
        "warning"
      );
      return;
    }

    const replacement = alreadyWrapped ? selectedText : `{{${selectedText}}}`;
    const newValue =
      value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
    input.value = newValue;
    const newStart = selectionStart;
    const newEnd = selectionStart + replacement.length;
    input.setSelectionRange(newStart, newEnd);
    input.focus();
    updateStatus(
      "\u5df2\u6807\u8bb0\u6240\u9009\u540d\u79f0\u4e3a\u5f3a\u5236\u89e3\u6790\u3002"
    );
  }

  function markSelectionAsPassthrough() {
    const input = dom.rawInput;
    if (!input) {
      return;
    }
    const { selectionStart, selectionEnd, value } = input;
    if (
      selectionStart == null ||
      selectionEnd == null ||
      selectionStart === selectionEnd
    ) {
      updateStatus(
        "\u8bf7\u9009\u62e9\u9700\u8981\u6807\u8bb0\u4e3a\u539f\u6837\u8f93\u51fa\u7684\u5185\u5bb9\u540e\u518d\u4f7f\u7528 Ctrl+3\u3002",
        "warning"
      );
      return;
    }
    const selectedText = value.slice(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      updateStatus(
        "\u9009\u4e2d\u7684\u5185\u5bb9\u4e3a\u7a7a\u767d\uff0c\u65e0\u6cd5\u6807\u8bb0\u3002",
        "warning"
      );
      return;
    }

    const alreadyWrapped =
      selectedText.startsWith("[[") && selectedText.endsWith("]]");
    const surroundingWrapped =
      !alreadyWrapped &&
      value.lastIndexOf("[[", selectionStart) !== -1 &&
      value.indexOf("]]", selectionEnd) !== -1 &&
      value.lastIndexOf("[[", selectionStart) < selectionStart &&
      value.indexOf("]]", selectionEnd) >= selectionEnd;

    if (surroundingWrapped) {
      updateStatus(
        "\u8be5\u5185\u5bb9\u5df2\u6807\u8bb0\u4e3a\u539f\u6837\u8f93\u51fa\u3002",
        "warning"
      );
      return;
    }

    const replacement = alreadyWrapped ? selectedText : `[[${selectedText}]]`;
    const newValue =
      value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
    input.value = newValue;
    const newStart = selectionStart;
    const newEnd = selectionStart + replacement.length;
    input.setSelectionRange(newStart, newEnd);
    input.focus();
    updateStatus(
      "\u5df2\u6807\u8bb0\u4e3a\u539f\u6837\u8f93\u51fa\uff08\u4ec5\u5220\u9664\u591a\u4f59\u7a7a\u683c\uff09\u3002"
    );
  }

  function flattenInputRecords() {
    const input = dom.rawInput;
    if (!input) {
      return;
    }
    const { selectionStart, selectionEnd, value } = input;
    if (
      selectionStart == null ||
      selectionEnd == null ||
      selectionStart === selectionEnd
    ) {
      updateStatus(
        "\u8bf7\u9009\u62e9\u9700\u8981\u5408\u5e76\u7684\u8bb0\u5f55\u540e\u518d\u4f7f\u7528 Ctrl+1\u3002",
        "warning"
      );
      return;
    }
    const selectedText = value.slice(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      updateStatus(
        "\u9009\u4e2d\u7684\u5185\u5bb9\u4e3a\u7a7a\u767d\uff0c\u65e0\u6cd5\u5408\u5e76\u3002",
        "warning"
      );
      return;
    }

    const flattened = buildFlattenedRecordText(selectedText);
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    const newValue = before + flattened + after;
    input.value = newValue;
    const newStart = selectionStart;
    const newEnd = selectionStart + flattened.length;
    input.setSelectionRange(newStart, newEnd);
    input.focus();
    updateStatus(
      "\u5df2\u5c1d\u8bd5\u5408\u5e76\u6240\u9009\u8bb0\u5f55\uff0c\u8bf7\u786e\u8ba4\u540e\u518d\u8f6c\u6362\u3002"
    );
  }

  function buildFlattenedRecordText(raw) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    const groups = [];
    let buffer = [];

    const flushBuffer = () => {
      if (buffer.length === 0) {
        return;
      }
      const merged = buffer.join(" ").replace(/\s+/g, " ").trim();
      const { processedLine, forcedNames } = preprocessForcedNames(merged);
      const normalized = normalizeLine(processedLine);
      const extraction = extractPairs(normalized, forcedNames);
      if (extraction.success) {
        const flattened = extraction.pairs.map(
          ({ name, score }) => `${name}${score}`
        );
        groups.push(flattened.join(" "));
      } else {
        groups.push(buffer.join(" "));
      }
      buffer = [];
    };

    lines.forEach((line) => {
      if (!line) {
        flushBuffer();
        groups.push("");
        return;
      }
      buffer.push(line);
      const merged = buffer.join(" ").replace(/\s+/g, " ").trim();
      const { processedLine, forcedNames } = preprocessForcedNames(merged);
      const normalized = normalizeLine(processedLine);
      const extraction = extractPairs(normalized, forcedNames);
      if (extraction.success) {
        const flattened = extraction.pairs.map(
          ({ name, score }) => `${name}${score}`
        );
        groups.push(flattened.join(" "));
        buffer = [];
      }
    });

    flushBuffer();

    while (groups.length > 0 && groups[groups.length - 1] === "") {
      groups.pop();
    }

    return groups.join("\n");
  }
})();
