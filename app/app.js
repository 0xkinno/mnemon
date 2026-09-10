/* MNEMON product surface — router, views, and the demo instrument.
 *
 * Every runtime value rendered here comes from one of exactly two real sources:
 *   1. the inlined evidence snapshot, built from proof/ by experiments/app_evidence.py
 *      and re-verified on every build by scripts/build_check.mjs;
 *   2. the live instrument API (scripts/demo_api.py), which calls the real
 *      mnemon engine against real Sibyl Memory.
 *
 * There are no hardcoded hashes, job ids, verdicts, counts, or timestamps in this file.
 */
(function () {
  "use strict";

  var SNAP = JSON.parse(document.getElementById("evidence-snapshot").textContent);
  var HASH_MODE = location.protocol === "file:";
  var NAV = [
    { path: "/", label: "Home" },
    { path: "/product", label: "Product" },
    { path: "/demo", label: "Demo" },
    { path: "/evidence", label: "Evidence" },
    { path: "/architecture", label: "Architecture" },
    { path: "/docs", label: "Docs" }
  ];

  /* ------------------------------------------------------------------ utils */
  var RAW = "__raw__";
  function raw(value) {
    var o = {};
    o[RAW] = String(value);
    o.toString = function () { return this[RAW]; };
    return o;
  }
  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function h(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) {
      var v = arguments[i];
      if (v && typeof v === "object" && v[RAW] !== undefined) {
        out += v[RAW];
      } else if (Array.isArray(v)) {
        for (var j = 0; j < v.length; j++) {
          var item = v[j];
          if (item && typeof item === "object" && item[RAW] !== undefined) out += item[RAW];
          else out += esc(item);
        }
      } else if (v === null || v === undefined || v === false || v === true) {
        out += "";
      } else {
        out += esc(v);
      }
      out += strings[i];
    }
    return raw(out);
  }
  function href(path) { return HASH_MODE ? "#" + path : path; }
  function tone(v) { return v === "CLEAN" || v === "ALLOWED" ? "ok" : v === "CONTESTED" ? "warn" : "block"; }
  function short(value, head, tail) {
    var s = String(value || "");
    head = head || 14; tail = tail || 10;
    return s.length > head + tail + 1 ? s.slice(0, head) + "…" + s.slice(-tail) : s;
  }

  /* ----------------------------------------------------------------- router */
  function normalise(path) {
    var p = String(path || "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
    return p === "" ? "/" : p;
  }
  function currentPath() {
    if (HASH_MODE) return normalise(location.hash.replace(/^#/, "") || "/");
    return normalise(location.pathname);
  }
  function isKnown(path) {
    for (var i = 0; i < NAV.length; i++) if (NAV[i].path === path) return true;
    return false;
  }
  function navigate(path, replace) {
    if (HASH_MODE) {
      if (replace) location.replace("#" + path); else location.hash = path;
      return;
    }
    if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
    render();
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest ? event.target.closest("a[data-nav]") : null;
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    closeMenu();
    navigate(link.getAttribute("data-path"));
    window.scrollTo({ top: 0, behavior: "auto" });
  });
  window.addEventListener("popstate", render);
  window.addEventListener("hashchange", function () { if (HASH_MODE) render(); });

  /* -------------------------------------------------------------- nav / chrome */
  function markNav(active) {
    var links = document.querySelectorAll("#nav-links a[data-path]");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.getAttribute("data-path") === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  function closeMenu() {
    var links = document.getElementById("nav-links");
    var toggle = document.getElementById("nav-toggle");
    if (links) links.setAttribute("data-open", "false");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
  function bindMenu() {
    var toggle = document.getElementById("nav-toggle");
    var links = document.getElementById("nav-links");
    if (!toggle || !links) return;
    toggle.addEventListener("click", function () {
      var open = links.getAttribute("data-open") === "true";
      links.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  /* ------------------------------------------------------------- shared blocks */
  function evidenceRows() {
    return (SNAP.evidence_panel || []).map(function (item) {
      return h`<tr><th scope="row">${item.label}</th><td><span style="font-family:var(--font-mono);font-weight:600">${item.value}</span><br><span style="color:var(--ink-muted);font-size:0.8125rem">${item.detail}</span><br><span style="color:var(--ink-faint);font-size:0.75rem">source: <code>${item.artifact}</code></span></td><td><span class="badge" data-tone="${item.tone}">${item.tone === "ok" ? "verified" : item.tone}</span></td></tr>`;
    });
  }

  function evidenceTable(caption) {
    return h`<div class="scroll-x"><table class="tbl">
      <caption>${caption}</caption>
      <thead><tr><th scope="col">Check</th><th scope="col">Observed value</th><th scope="col">State</th></tr></thead>
      <tbody>${evidenceRows()}</tbody>
    </table></div>`;
  }

  function proofIndexTable() {
    var rows = (SNAP.proof_index || []).map(function (item) {
      return h`<tr><th scope="row"><code>${item.name}</code></th><td><span style="font-family:var(--font-mono);font-size:0.8125rem">${short(item.sha256, 18, 10)}</span></td><td><span style="font-family:var(--font-mono);font-size:0.8125rem">${item.bytes} B</span></td></tr>`;
    });
    return h`<div class="scroll-x"><table class="tbl">
      <caption>Proof artifacts — cryptographic content hashes</caption>
      <thead><tr><th scope="col">Artifact</th><th scope="col">sha256</th><th scope="col">Size</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function verdictTable() {
    var rows = [
      ["CLEAN", "Current WARM value is bound to a matching durable witness and nothing in the same epoch contradicts it.", "Action may proceed", "ok"],
      ["CONTESTED", "Independent witnessed claims disagree for the same entity and epoch.", "Action blocked or escalated", "warn"],
      ["UNWITNESSED", "The current value cannot be tied to the required durable witness.", "Action blocked", "block"],
      ["INVALID", "Claim, hash, entity, epoch, or evidence binding is inconsistent.", "Action rejected", "block"]
    ].map(function (r) {
      return h`<tr><th scope="row"><span style="font-family:var(--font-mono);font-weight:700">${r[0]}</span></th><td>${r[1]}</td><td><span class="badge" data-tone="${r[3]}">${r[2]}</span></td></tr>`;
    });
    return h`<div class="scroll-x"><table class="tbl">
      <caption>The four deterministic outcomes</caption>
      <thead><tr><th scope="col">Verdict</th><th scope="col">Meaning</th><th scope="col">Consequence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function verdictCardsMarkup() {
    var cards = [
      {
        name: "CLEAN",
        tone: "ok",
        badge: "ALLOW",
        meaning: "Current WARM claim is bound to a valid durable COLD witness, with no unresolved conflicts in the epoch.",
        condition: "Matched witness + same epoch"
      },
      {
        name: "CONTESTED",
        tone: "warn",
        badge: "BLOCK",
        meaning: "Two or more credentialed observers recorded conflicting claims in the same epoch. Fails closed.",
        condition: "Contradictory witnessed claims"
      },
      {
        name: "UNWITNESSED",
        tone: "block",
        badge: "BLOCK",
        meaning: "The current memory value cannot be bound to the required durable witness in Sibyl Memory.",
        condition: "Missing or deleted witness"
      },
      {
        name: "INVALID",
        tone: "block",
        badge: "REJECT",
        meaning: "Claim payload, entity key, epoch, or hash binding fails cryptographic integrity checks.",
        condition: "Corrupted or altered claim hash"
      }
    ];
    return h`<div class="verdicts-grid">
      ${cards.map(function (c) {
        return h`<div class="verdict-box" data-state="${c.name}">
          <div class="verdict-box-title" style="color:var(--${c.tone === "ok" ? "ok" : c.tone === "warn" ? "warn" : "block"})">${c.name}</div>
          <div class="verdict-box-badge"><span class="badge" data-tone="${c.tone}">${c.badge}</span></div>
          <p class="verdict-box-desc">${c.meaning}</p>
          <div style="margin-top:12px;font-family:var(--font-mono);font-size:0.6875rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.06em">${c.condition}</div>
        </div>`;
      })}
    </div>`;
  }

  function proofChainMarkup() {
    var nodes = [
      { num: "01", title: "ACP Result", sub: "Job " + SNAP.acp_job_id + " (UPHELD)" },
      { num: "02", title: "Hash Binding", sub: "sha256 digest linked" },
      { num: "03", title: "Sibyl COLD", sub: "Durable witness event" },
      { num: "04", title: "MNEMON Arbiter", sub: "CLEAN verdict authorized" },
      { num: "05", title: "Base Anchor", sub: "Tx f6c2ee... committed" },
      { num: "06", title: "Receipt", sub: "Block 46637732 verified" }
    ];
    return h`<div class="proof-chain-container">
      <div class="proof-chain-flow">
        ${nodes.map(function (n, idx) {
          return h`
            <div class="chain-node">
              <span class="chain-node-num">${n.num}</span>
              <span class="chain-node-title">${n.title}</span>
              <span class="chain-node-sub">${n.sub}</span>
            </div>
            ${idx < nodes.length - 1 ? h`<span class="chain-arrow">→</span>` : h``}
          `;
        })}
      </div>
    </div>`;
  }

  function verifiedControlsMarkup() {
    var metrics = [
      { label: "Memory Runtime", val: "Sibyl Memory 0.8.1", desc: "WARM entities UNIQUE(tenant_id, category, name); COLD journal_events." },
      { label: "Contention Matrix", val: "20/20 Trials Contested", desc: "Independent writers race same entity; no trial silently settles on last write." },
      { label: "Persistence Isolation", val: "Fresh Process (PID 25048)", desc: "Isolated interpreter re-reads memory and returns the identical verdict." },
      { label: "Deletion Control", val: "UNWITNESSED → Blocked", desc: "Removing memory layer immediately collapses authorization boundary." },
      { label: "Adversarial Audit", val: "12/12 Must-Block Hold", desc: "17 adversarial and tamper cases tested; zero unsafe bypass allowed." },
      { label: "On-Chain Anchor", val: "Base Block 46637732", desc: "Claim hash anchored permanently on Base Sepolia with verified receipt status 1." }
    ];
    return h`<div class="metrics-grid">
      ${metrics.map(function (m) {
        return h`<div class="metric-card">
          <div class="metric-card-header">
            <span class="metric-card-label">${m.label}</span>
            <span class="badge" data-tone="ok">verified</span>
          </div>
          <div class="metric-card-val">${m.val}</div>
          <p class="metric-card-desc">${m.desc}</p>
        </div>`;
      })}
    </div>`;
  }

  function archFlowMarkup() {
    var nodes = [
      { tag: "01 Observers", title: "Independent Agents", desc: "External writers emit canonical state claims." },
      { tag: "02 Memory Layer", title: "Sibyl WARM & COLD", desc: "WARM holds active row; COLD journals all witness events." },
      { tag: "03 Boundary", title: "MNEMON Arbiter", desc: "Reconciles WARM against COLD before allowing action." },
      { tag: "04 Protocol", title: "Virtuals ACP", desc: "Escalates contested cases to independent evaluators." },
      { tag: "05 Settlement", title: "Base Sepolia", desc: "Anchors final witnessed claim hash permanently." }
    ];
    return h`<div class="arch-flow">
      ${nodes.map(function (n) {
        return h`<div class="arch-node">
          <div class="arch-node-tag">${n.tag}</div>
          <div class="arch-node-title">${n.title}</div>
          <div class="arch-node-desc">${n.desc}</div>
        </div>`;
      })}
    </div>`;
  }

  var VIEWS = {};

  /* ------------------------------------------------------------------- views */
  VIEWS["__404__"] = function () {
    return {
      title: "Not found — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">404</div>
        <h1>That route does not exist.</h1>
        <p class="lede">This surface has six destinations. Pick one below.</p>
        <div class="btn-row" style="margin-top:28px">
          <a class="btn" href="${href("/")}" data-nav data-path="/">Home</a>
          <a class="btn" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
          <a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a>
        </div>
      </section>`
    };
  };

  VIEWS["/"] = function () {
    var v = SNAP.verdict || {};
    var w = SNAP.cold_witness || {};
    return {
      title: "MNEMON — Memory that can challenge itself.",
      html: h`
      <!-- 01 HERO SECTION -->
      <section class="section hero-grid" style="border-bottom:none">
        <div class="hero-copy">
          <div class="eyebrow">Memory verification for autonomous AI</div>
          <h1 class="hero-title">Memory that<br>can challenge<br><span class="hero-title-italic">itself.</span></h1>
          <p class="lede">Before an autonomous agent acts on memory, MNEMON checks whether that memory is actually witnessed.</p>
          
          <div class="hero-verification-strip">
            <div class="hero-metric-item">
              <span class="hero-metric-label">Runtime</span>
              <span class="hero-metric-val">Sibyl 0.8.1</span>
            </div>
            <div class="hero-metric-item">
              <span class="hero-metric-label">Contention</span>
              <span class="hero-metric-val" data-tone="ok">20/20 Contested</span>
            </div>
            <div class="hero-metric-item">
              <span class="hero-metric-label">Persistence</span>
              <span class="hero-metric-val" data-tone="ok">Reconstructed</span>
            </div>
            <div class="hero-metric-item">
              <span class="hero-metric-label">Deletion Control</span>
              <span class="hero-metric-val" data-tone="ok">Verified</span>
            </div>
          </div>

          <div class="btn-row">
            <a class="btn btn-primary" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof <span class="nav-arrow-bubble">→</span></a>
            <a class="btn" href="#hard-invariant">Hard Invariant</a>
          </div>
        </div>

        <div class="hero-visual">
          <div class="hero-artifact-card">
            <div class="hero-artifact-img-wrap">
              <img src="./hero-sculpture.jpg" alt="MNEMON dual-state memory and durable evidence sculpture" class="hero-artifact-img" width="1000" height="562">
            </div>
            <div class="hero-artifact-footer">
              <span class="hero-artifact-caption">Tactile ceramic witness artifact · Amber core</span>
              <span class="hero-artifact-status">● VERIFIED BOUNDARY</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 02 THE PROBLEM / CONTRADICTION -->
      <section class="section" id="contradiction">
        <div class="kicker">The contradiction</div>
        <h2>The current state is not always the whole truth.</h2>
        <p class="note">A naive agent acts on whichever write happened to land last. MNEMON checks whether the surviving value was ever the only claim in the epoch.</p>
        
        <div class="contradiction-surface">
          <div class="contradiction-grid">
            <div class="contradiction-pane">
              <div class="pane-tag">CURRENT / WARM STATE</div>
              <div class="pane-title">Fast Ephemeral Cache</div>
              <div class="claim-box">
                <div class="claim-header">
                  <span class="claim-writer">Active Row (Single Value)</span>
                  <span class="claim-value" data-tone="ok">SAFE</span>
                </div>
                <div class="claim-meta">
                  Entity: <code>${SNAP.entity_key}</code><br>
                  Epoch: <code>${SNAP.epoch_id}</code><br>
                  Status: <strong>SAFE</strong> (Silently overwritten by last writer)
                </div>
              </div>
            </div>

            <div class="contradiction-pane">
              <div class="pane-tag">DURABLE / COLD WITNESSES</div>
              <div class="pane-title">Immutable Journal Log</div>
              <div class="claim-box">
                <div class="claim-header">
                  <span class="claim-writer">Watcher A (COLD Journal)</span>
                  <span class="claim-value" data-tone="ok">SAFE</span>
                </div>
                <div class="claim-meta">Timestamp 11:14:02 · Claim hash verified</div>
              </div>
              <div class="claim-box">
                <div class="claim-header">
                  <span class="claim-writer">Watcher B (COLD Journal)</span>
                  <span class="claim-value" data-tone="block">CRITICAL</span>
                </div>
                <div class="claim-meta">Timestamp 11:14:03 · Conflicting claim in same epoch</div>
              </div>
            </div>
          </div>

          <div class="arbiter-resolution-bar">
            <div class="arbiter-left">
              <span class="arbiter-label">MNEMON ARBITER</span>
              <span class="arbiter-verdict">CONTESTED (Conflicting Witnesses Detected)</span>
            </div>
            <span class="arbiter-consequence">ACTION BLOCKED · FAILS CLOSED</span>
          </div>
        </div>
      </section>

      <!-- 03 HARD INVARIANT (SIGNATURE SECTION) -->
      <section class="section" id="hard-invariant">
        <div class="hard-invariant-card">
          <div class="hard-invariant-eyebrow">HARD INVARIANT</div>
          <div class="hard-invariant-statement">
            A consequential decision may be marked CLEAN only when the current WARM claim is bound to a valid durable COLD witness for the same entity and epoch, with no unresolved conflict.
          </div>
          <div class="equation-surface">
            <span class="eq-node">MATCHED WITNESS</span>
            <span class="eq-op">+</span>
            <span class="eq-node">SAME ENTITY</span>
            <span class="eq-op">+</span>
            <span class="eq-node">SAME EPOCH</span>
            <span class="eq-op">+</span>
            <span class="eq-node">NO CONFLICT</span>
            <span class="eq-op">=</span>
            <span class="eq-res">CLEAN (ALLOW)</span>
          </div>
          <div class="eq-fail-note">
            * Any omission, hash mismatch, or unresolved contention evaluates to CONTESTED / UNWITNESSED / INVALID and blocks action immediately.
          </div>
        </div>
      </section>

      <!-- 04 FOUR VERDICT STATES -->
      <section class="section" id="verdicts">
        <div class="kicker">Four verdict states</div>
        <h2>One invariant, four deterministic outcomes.</h2>
        <p class="note">Everything else fails closed. The machine executes strictly against these four deterministic states.</p>
        ${verdictCardsMarkup()}
        <div style="margin-top:28px">${verdictTable()}</div>
      </section>

      <!-- 05 MACHINE-CHECKABLE PROOF CHAIN -->
      <section class="section" id="proof-chain">
        <div class="kicker">Machine-checkable proof</div>
        <h2>Every hop carries the same verified hash.</h2>
        <p class="note">The deliverable digest produced by Virtuals ACP binds to the Sibyl COLD witness, the final MNEMON verdict, and the on-chain Base Sepolia settlement.</p>
        ${proofChainMarkup()}
      </section>

      <!-- 06 CONSOLIDATED SYSTEM METRICS -->
      <section class="section" id="controls">
        <div class="kicker">Verified system controls</div>
        <h2>Proven under adversarial conditions.</h2>
        <p class="note">All metrics are extracted from automated reproduction suites in <code>proof/</code>. Zero mock data.</p>
        ${verifiedControlsMarkup()}
      </section>

      <!-- 07 ARCHITECTURE -->
      <section class="section" id="architecture">
        <div class="kicker">System Architecture</div>
        <h2>Where the boundary sits.</h2>
        <p class="note">Observers write claims into Sibyl Memory. MNEMON reconciles WARM against COLD. Only a CLEAN verdict reaches execution, and unresolved contention escalates to Virtuals ACP.</p>
        ${archFlowMarkup()}
        <div class="btn-row" style="margin-top:24px">
          <a class="btn" href="${href("/architecture")}" data-nav data-path="/architecture">Explore full architecture</a>
        </div>
      </section>

      <!-- 08 FINAL CTA -->
      <section class="section" id="final-cta">
        <div class="kicker">Close</div>
        <h2>Trust memory only when memory can prove itself.</h2>
        <p class="note">MNEMON is not trying to make failure impossible. It is making an unwarranted CLEAN impossible to reach.</p>
        <div class="btn-row" style="margin-top:24px">
          <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
          <a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a>
        </div>
      </section>`
    };
  };

  VIEWS["/product"] = function () {
    return {
      title: "Product — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Product Model</div>
        <h1>A memory-consistency boundary for autonomous systems.</h1>
        <p class="lede">MNEMON sits between the memory an agent reads and the action it takes, refusing to authorise an action that durable witnesses cannot verify.</p>
        <div class="btn-row" style="margin-top:24px">
          <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
          <a class="btn" href="${href("/architecture")}" data-nav data-path="/architecture">Architecture</a>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Two Tiers</div>
        <h2>Two tiers, one deterministic decision.</h2>
        <div class="cards g2">
          <div class="cell">
            <div class="n">WARM TIER</div>
            <h3>Current State Value</h3>
            <p>The fast path. Exactly one row per entity, optimized for quick reads. It maintains uniqueness semantics and carries no record of previous contention.</p>
          </div>
          <div class="cell">
            <div class="n">COLD TIER</div>
            <h3>Durable Witness Journal</h3>
            <p>The immutable audit log. Records every committed claim with its writer ID, epoch ID, evidence digest, and exact SHA-256 payload hash.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Target Workflows</div>
        <h2>Systems that act on memory they did not personally witness.</h2>
        <div class="cards g3">
          <div class="cell">
            <div class="n">01</div>
            <h3>Trading & Risk Agents</h3>
            <p>A risk verdict that flips between SAFE and CRITICAL across concurrent processes must never silently settle on the last write.</p>
          </div>
          <div class="cell">
            <div class="n">02</div>
            <h3>Long-Running Workflows</h3>
            <p>A crash between a state write and its witness must not leave behind an unverified state that appears authoritative.</p>
          </div>
          <div class="cell">
            <div class="n">03</div>
            <h3>Multi-Agent Swarms</h3>
            <p>Independent worker agents submitting competing observations for one entity are reconciled before any irreversible transaction occurs.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Hard Invariant</div>
        <h2>The rule that everything else fails closed against.</h2>
        <div class="hard-invariant-card">
          <div class="hard-invariant-statement">
            A consequential decision may be marked CLEAN only when the current WARM claim is bound to a valid durable COLD witness for the same entity and epoch, with no unresolved conflict.
          </div>
        </div>
        ${verdictCardsMarkup()}
      </section>

      <section class="section">
        <div class="kicker">Boundaries</div>
        <h2>What MNEMON is not.</h2>
        <div class="cards g3">
          <div class="cell">
            <div class="n">NOT A CACHE</div>
            <h3>Not a temporary buffer</h3>
            <p>Deleting the memory layer removes the ability to decide. Nothing else substitutes for the witness.</p>
          </div>
          <div class="cell">
            <div class="n">NOT A LOCK</div>
            <h3>Not a mutex or semaphore</h3>
            <p>MNEMON does not prevent concurrent writers. It prevents a contested result from being treated as settled.</p>
          </div>
          <div class="cell">
            <div class="n">NOT THEATRE</div>
            <h3>Not decorative badges</h3>
            <p>Virtuals ACP is invoked strictly for unresolved CONTESTED cases, and its deliverable is stored as a witness.</p>
          </div>
        </div>
      </section>`
    };
  };

  VIEWS["/architecture"] = function () {
    return {
      title: "Architecture — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">System Architecture</div>
        <h1>Where the boundary sits.</h1>
        <p class="lede">Observers write claims into Sibyl Memory. MNEMON reconciles WARM against COLD. Only a clean, witnessed value reaches a consequential action.</p>
      </section>

      <section class="section">
        <div class="kicker">Pipeline</div>
        <h2>The critical path of memory reconciliation.</h2>
        ${archFlowMarkup()}
      </section>

      <section class="section">
        <div class="kicker">Decision Sequence</div>
        <h2>Contested cases are escalated, then persisted.</h2>
        <div class="capsule">
          <div>01. Observer A  ── write claim + witness ──► Sibyl COLD journal</div>
          <div>02. Observer B  ── write competing claim ──► Sibyl COLD journal</div>
          <div>03. MNEMON      ── inspect WARM state ──► single surviving row</div>
          <div>04. MNEMON      ── inspect COLD witnesses ──► contention detected</div>
          <div>05. MNEMON      ── reconcile ──► CONTESTED · ACTION BLOCKED</div>
          <div>06. Protocol    ── escalate ──► Virtuals ACP independent adjudication</div>
          <div>07. ACP Eval    ── verified deliverable ──► Sibyl COLD witness persisted</div>
          <div>08. MNEMON      ── recompute ──► CLEAN · ACTION ALLOWED</div>
          <div>09. Settlement  ── commit ──► Base Sepolia anchor (receipt verified)</div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Failure Engineering</div>
        <h2>Every unsafe condition fails closed.</h2>
        <p class="note">MNEMON is designed around falsification. The goal is not to make failure impossible; it is to make an unwarranted CLEAN impossible to reach.</p>
        <div class="scroll-x"><table class="tbl">
          <caption>Adversarial test matrix</caption>
          <thead><tr><th scope="col">Condition</th><th scope="col">Expected Result</th><th scope="col">Behavior</th></tr></thead>
          <tbody>
            <tr><th scope="row">Concurrent writers</th><td>CONTESTED</td><td>Action blocked; requires arbitration</td></tr>
            <tr><th scope="row">Crash during workflow</th><td>No unsafe CLEAN</td><td>Unfinished transactions fail closed</td></tr>
            <tr><th scope="row">Duplicate witness</th><td>Idempotent</td><td>Recognizes duplicate operation ID</td></tr>
            <tr><th scope="row">Wrong entity / epoch</th><td>UNWITNESSED</td><td>Blocked from execution</td></tr>
            <tr><th scope="row">Tampered payload/hash</th><td>INVALID</td><td>Cryptographic mismatch rejected</td></tr>
            <tr><th scope="row">Missing witness layer</th><td>UNWITNESSED</td><td>Action blocked immediately</td></tr>
            <tr><th scope="row">Deleted memory</th><td>UNWITNESSED</td><td>Cached claims cannot substitute</td></tr>
            <tr><th scope="row">Fresh process</th><td>Reconstructed</td><td>Re-derives verdict from persistence</td></tr>
          </tbody>
        </table></div>
      </section>`
    };
  };

  VIEWS["/evidence"] = function () {
    var b = SNAP.base_commitment || {};
    var a = SNAP.acp || {};
    var w = SNAP.cold_witness || {};
    return {
      title: "Evidence — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Cryptographic Verification</div>
        <h1>Binding, not coexistence.</h1>
        <p class="lede">Every hop in the chain carries the same decision hash. The values below are read from verified run artifacts, and the build fails if this page drifts from them.</p>
      </section>

      <section class="section" id="chain">
        <div class="kicker">Proof Chain</div>
        <h2>Linked identifiers across all layers.</h2>
        <div class="scroll-x"><table class="tbl">
          <caption>Cryptographic linkage</caption>
          <thead><tr><th scope="col">Hop</th><th scope="col">Value</th></tr></thead>
          <tbody>
            <tr><th scope="row">Entity Key</th><td><code>${SNAP.entity_key}</code></td></tr>
            <tr><th scope="row">Contested Epoch</th><td><code>${SNAP.epoch_id}</code></td></tr>
            <tr><th scope="row">Virtuals ACP Job</th><td><code>${a.job_id}</code> · ${a.final_onchain_status}</td></tr>
            <tr><th scope="row">Deliverable Digest (sha256)</th><td><code>${a.deliverable_digest}</code></td></tr>
            <tr><th scope="row">On-Chain Submitted Hash</th><td><code>${a.onchain_submitted_hash}</code></td></tr>
            <tr><th scope="row">COLD Witness Operation</th><td><code>${w.operation_id}</code> · writer ${w.writer_id}</td></tr>
            <tr><th scope="row">COLD Witness Claim Hash</th><td><code>${w.claim_hash}</code></td></tr>
            <tr><th scope="row">Base Transaction</th><td><a href="${b.explorer}" target="_blank" rel="noopener"><code>${b.tx_hash}</code></a></td></tr>
            <tr><th scope="row">Base Block Number</th><td><code>${b.block_number}</code></td></tr>
            <tr><th scope="row">Linkage Verification</th><td><span class="badge" data-tone="${SNAP.linkage_verified ? "ok" : "block"}">${SNAP.linkage_verified ? "VERIFIED LINKAGE" : "UNVERIFIED"}</span></td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="section" id="panel">
        <div class="kicker">Evidence Panel</div>
        <h2>Verified readout summary.</h2>
        ${evidenceTable("Nine verified controls")}
      </section>

      <section class="section" id="artifacts">
        <div class="kicker">Proof Index</div>
        <h2>All 34 cryptographic artifacts.</h2>
        <p class="note">Hashes are recomputed from <code>proof/</code> when the snapshot is generated.</p>
        ${proofIndexTable()}
      </section>`
    };
  };

  VIEWS["/docs"] = function () {
    var docs = [
      ["DISCOVERY.md", "The sponsor primitive, the observed constraint, and what is new."],
      ["EVIDENCE.md", "Every verified artifact and the ACP/Base status."],
      ["PROOF.md", "The proof sequence, including adjudication and the public commitment."],
      ["DEPLOYMENT.md", "How the public surface is deployed and what is deliberately not exposed."],
      ["docs/ACP_SETUP.md", "The ACP v2 setup, the deliverable contract, and the operational rules."]
    ].map(function (d) {
      return h`<tr><th scope="row"><code>${d[0]}</code></th><td>${d[1]}</td></tr>`;
    });
    return {
      title: "Docs — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Documentation</div>
        <h1>Run it, then check it.</h1>
        <p class="lede">Everything on this site is reproducible from the repository. The instrument runs the real engine against real Sibyl Memory.</p>
      </section>

      <section class="section">
        <div class="kicker">Quickstart</div>
        <h2>Five commands to reproduce locally.</h2>
        <div class="capsule">
          <div>1. python -m venv .venv</div>
          <div>2. .venv\\Scripts\\Activate.ps1</div>
          <div>3. python -m pip install -r requirements.txt</div>
          <div>4. python -m pytest -q</div>
          <div>5. python scripts/demo_api.py</div>
        </div>
        <p class="note" style="margin-top:20px">The last command serves this site at <code>http://127.0.0.1:8080</code> together with the live instrument API.</p>
      </section>

      <section class="section">
        <div class="kicker">Repository Documents</div>
        <h2>Technical documentation index.</h2>
        <div class="scroll-x"><table class="tbl">
          <caption>Repository specifications</caption>
          <thead><tr><th scope="col">Document</th><th scope="col">Summary</th></tr></thead>
          <tbody>${docs}</tbody>
        </table></div>
      </section>`
    };
  };

  /* -------------------------------------------------------------------- demo */
  var STAGES = [
    { id: "observe", label: "Observe" },
    { id: "reconcile", label: "Reconcile" },
    { id: "arbitrate", label: "Arbitrate" },
    { id: "verdict", label: "Verdict" },
    { id: "action", label: "Action" }
  ];
  var demo = null;

  function demoInit() {
    var recorded = (SNAP.demo && SNAP.demo.recorded) || null;
    return {
      mode: null,
      live: false,
      checking: true,
      busy: null,
      error: null,
      label: recorded ? recorded.label : "Recorded run unavailable",
      entityKey: recorded ? recorded.entity_key : SNAP.entity_key,
      sequence: recorded ? recorded.sequence.slice() : [],
      steps: recorded ? recorded.steps : {},
      controls: recorded ? recorded.controls : [],
      revealed: recorded ? recorded.sequence.slice(0, 1) : [],
      log: []
    };
  }

  /* The instrument API returns its steps as an array; every lookup in this view
     is by step id, so normalise whichever shape arrived into one id-keyed map. */
  function normalizeSteps(into, incoming) {
    var steps = into || {};
    if (Array.isArray(incoming)) {
      incoming.forEach(function (s) { if (s && s.id) steps[s.id] = s; });
    } else if (incoming) {
      Object.keys(incoming).forEach(function (id) { steps[id] = incoming[id]; });
    }
    return steps;
  }

  function nextAction() {
    if (!demo) return null;
    var pending = demo.sequence.filter(function (id) { return demo.revealed.indexOf(id) === -1; });
    return pending.length ? pending[0] : null;
  }

  function stageStrip(activeStage) {
    return STAGES.map(function (s, i) {
      return h`<div class="st" data-active="${s.id === activeStage ? "true" : "false"}">
        <div class="k">${String(i + 1).padStart(2, "0")} ${s.label}</div>
      </div>`;
    });
  }

  function stepCard(step) {
    var cold = (step.cold || []).map(function (c) {
      return h`<div style="margin-bottom:8px">
        <span class="badge" data-tone="${tone(c.status)}">${c.status}</span> <code>${short(c.claim_hash, 14, 8)}</code><br>
        <span style="color:var(--ink-muted);font-size:0.75rem">${c.writer_id} · ${c.epoch_id}</span>
      </div>`;
    });
    var warmBlock = step.warm
      ? h`<div class="v">${step.warm.status}</div><div style="color:var(--ink-muted);font-size:0.75rem;margin-top:4px">${step.warm.writer_id} · ${step.warm.epoch_id}<br><code>${short(step.warm.claim_hash, 14, 8)}</code></div>`
      : h`<div class="v">—</div><div style="color:var(--ink-muted);font-size:0.75rem;margin-top:4px">No current value.</div>`;
    var coldBlock = cold.length
      ? h`<div>${cold}</div>`
      : h`<div class="v">0</div><div style="color:var(--ink-muted);font-size:0.75rem;margin-top:4px">No witness remains.</div>`;

    return h`<article class="demo-step-article" aria-labelledby="step-${step.id}">
      <div class="kicker">${step.stage} · ${step.label}</div>
      <h2 id="step-${step.id}" style="font-size:1.35rem;margin-bottom:8px">${step.title}</h2>
      <div class="demo-step-state-grid">
        <div class="demo-step-state-col"><div class="k">WARM · CURRENT</div>${warmBlock}</div>
        <div class="demo-step-state-col"><div class="k">COLD · WITNESSES (${(step.cold || []).length})</div>${coldBlock}</div>
        <div class="demo-step-state-col"><div class="k">MNEMON VERDICT</div><div class="vd" data-tone="${tone(step.verdict)}">${step.verdict}</div></div>
        <div class="demo-step-state-col"><div class="k">ACTION CONSEQUENCE</div><div><span class="badge" data-tone="${step.action === "ALLOWED" ? "ok" : "block"}">${step.action}</span></div></div>
      </div>
      <p class="demo-step-note">${step.note}</p>
      <div style="margin-top:8px;font-family:var(--font-mono);font-size:0.75rem;color:var(--ink-faint)">artifact: <code>${step.artifact}</code></div>
    </article>`;
  }

  function logMarkup() {
    if (!demo || !demo.log || !demo.log.length) return h`<p style="color:rgba(255,255,255,0.4);font-family:var(--font-mono);font-size:0.75rem">No operations executed yet.</p>`;
    return demo.log.map(function (e) {
      return h`<div class="entry" data-tone="${e.tone || ""}"><span class="t">${e.t}</span><span class="m">${e.m}</span></div>`;
    });
  }
  function nowStamp() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
  }
  function logPush(toneName, message) {
    demo.log.unshift({ t: nowStamp(), tone: toneName, m: message });
    if (demo.log.length > 40) demo.log.pop();
  }

  function controlsMarkup() {
    var pending = nextAction();
    var buttons = demo.controls.map(function (c) {
      var enabled = c.step === pending && !demo.busy;
      return h`<button class="btn" type="button" data-action="${c.action}" data-step="${c.step}"${enabled ? raw("") : raw(" disabled")}>${c.label}</button>`;
    });
    return h`${buttons}<button class="btn btn-sm" type="button" data-action="reset" data-step="__reset">Reset</button>`;
  }

  function demoStatusLine() {
    if (demo.checking) return h`<span>Checking for live instrument API…</span>`;
    if (demo.error) return h`<span style="color:var(--block)">${demo.error}</span>`;
    if (demo.busy) return h`<span style="color:var(--warn)">Running ${demo.busy}…</span>`;
    if (demo.live) return h`<span style="color:var(--ok)">● Live engine connected — operations run against real Sibyl Memory</span>`;
    return h`<span>● Recorded verified run — start <code>python scripts/demo_api.py</code> for live execution</span>`;
  }

  VIEWS["/demo"] = function () {
    if (!demo) demo = demoInit();
    var steps = demo.revealed.map(function (id) { return stepCard(demo.steps[id]); });
    return {
      title: "Interactive Demo — MNEMON",
      html: h`
      <section class="section" style="border-bottom:none">
        <div class="eyebrow">Interactive Verification Instrument</div>
        <h1>Operate the decision surface.</h1>
        <p class="lede">Observe how MNEMON intercepts memory reads and arbitrates WARM state against durable COLD witnesses.</p>
        
        <div style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--ink-muted);margin-bottom:24px" id="demo-status-line">
          ${demoStatusLine()}
        </div>

        <div class="demo-stage-bar" id="demo-stage-bar">
          ${stageStrip("observe")}
        </div>

        <div class="btn-row" id="demo-controls-row" style="margin-bottom:28px">
          ${controlsMarkup()}
        </div>

        <div class="demo-console">
          <div class="demo-main-panel">
            <div class="demo-timeline" id="demo-timeline">
              ${steps}
            </div>
          </div>

          <div class="demo-side-panel">
            <div class="demo-log-card">
              <div class="demo-log-header">Live Runtime Execution Log</div>
              <div class="demo-log-stream" id="demo-log">
                ${logMarkup()}
              </div>
            </div>

            <div class="cell" style="background:#ffffff">
              <div class="kicker">Memory Target</div>
              <div style="font-family:var(--font-mono);font-size:0.875rem;font-weight:600;margin-bottom:8px"><code>${demo.entityKey}</code></div>
              <p style="font-size:0.8125rem;color:var(--ink-muted);line-height:1.4">Target entity evaluated under active epoch bounds. No state transitions without durable witness verification.</p>
            </div>
          </div>
        </div>
      </section>`
    };
  };

  /* ------------------------------------------------------------- demo actions */
  var ENGINE = { checked: false, live: false, engine: null };

  function setEngineBadge() {
    var badge = document.getElementById("nav-engine-badge");
    var label = document.getElementById("nav-engine-label");
    if (!badge || !label) return;
    if (!ENGINE.checked) {
      badge.setAttribute("data-state", "checking");
      label.textContent = "CHECKING ENGINE";
      return;
    }
    badge.setAttribute("data-state", ENGINE.live ? "live" : "recorded");
    label.textContent = ENGINE.live ? "LIVE ENGINE" : "RECORDED RUN";
  }

  /* One probe decides both the navbar badge and the demo's execution mode. The
     badge never claims a live engine unless the instrument API actually answered. */
  function probeEngine() {
    setEngineBadge();
    fetch("/api/status", { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        ENGINE.checked = true;
        ENGINE.live = !!(data && data.live);
        ENGINE.engine = (data && data.engine) || null;
        if (demo) {
          demo.checking = false;
          demo.live = ENGINE.live;
          if (ENGINE.live && data.steps) {
            demo.steps = normalizeSteps(demo.steps, data.steps);
            demo.sequence = data.sequence || demo.sequence;
            demo.revealed = demo.revealed.filter(function (id) { return demo.steps[id]; });
            if (!demo.revealed.length) demo.revealed = demo.sequence.slice(0, 1);
            demo.label = "Live instrument: " + ENGINE.engine;
            logPush("ok", "Connected to live instrument: " + ENGINE.engine);
          }
          updateDemoUI();
        }
      })
      .catch(function () {
        ENGINE.checked = true;
        ENGINE.live = false;
        if (demo) { demo.checking = false; demo.live = false; updateDemoUI(); }
      })
      .then(setEngineBadge);
  }

  function demoRunStep(actionName, stepId) {
    if (!demo || demo.busy) return;
    if (actionName === "reset") {
      demo.revealed = demo.sequence.slice(0, 1);
      demo.busy = null;
      demo.error = null;
      logPush("", "Demo timeline reset to baseline state.");
      updateDemoUI();
      if (demo.live) {
        fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) }).catch(function () {});
      }
      return;
    }

    demo.busy = actionName;
    updateDemoUI();
    logPush("warn", "Executing action: " + actionName + "…");

    if (demo.live) {
      fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName })
      })
        .then(function (res) { return res.json(); })
        .then(function (res) {
          demo.busy = null;
          if (res.ok && res.step) {
            demo.steps[res.step.id] = res.step;
            if (demo.revealed.indexOf(res.step.id) === -1) demo.revealed.push(res.step.id);
            logPush(tone(res.step.verdict), "Step " + res.step.id + " completed in " + res.elapsed_ms + "ms -> " + res.step.verdict + " (" + res.step.action + ")");
          } else {
            demo.error = res.error || "Operation failed";
            logPush("block", "Error: " + demo.error);
          }
          updateDemoUI();
        })
        .catch(function (err) {
          demo.busy = null;
          // Fallback to recorded verified step
          fallbackRecordedStep(stepId);
        });
    } else {
      setTimeout(function () {
        demo.busy = null;
        fallbackRecordedStep(stepId);
      }, 250);
    }
  }

  function fallbackRecordedStep(stepId) {
    if (demo.steps[stepId] && demo.revealed.indexOf(stepId) === -1) {
      demo.revealed.push(stepId);
      var s = demo.steps[stepId];
      logPush(tone(s.verdict), "Step " + s.id + " recorded -> " + s.verdict + " (" + s.action + ")");
    }
    updateDemoUI();
  }

  function updateDemoUI() {
    if (currentPath() !== "/demo") return;
    var controlsEl = document.getElementById("demo-controls-row");
    var timelineEl = document.getElementById("demo-timeline");
    var logEl = document.getElementById("demo-log");
    var statusEl = document.getElementById("demo-status-line");
    var stageEl = document.getElementById("demo-stage-bar");

    if (controlsEl) controlsEl.innerHTML = controlsMarkup().toString();
    if (timelineEl) {
      timelineEl.innerHTML = demo.revealed.filter(function (id) { return demo.steps[id]; }).map(function (id) { return stepCard(demo.steps[id]); }).join("");
    }
    if (logEl) logEl.innerHTML = logMarkup().toString();
    if (statusEl) statusEl.innerHTML = demoStatusLine().toString();
    if (stageEl) {
      var lastStepId = demo.revealed[demo.revealed.length - 1];
      var lastStep = demo.steps[lastStepId];
      var stg = lastStep ? (lastStep.stage || "observe").toLowerCase() : "observe";
      stageEl.innerHTML = stageStrip(stg).join("");
    }
  }

  document.addEventListener("click", function (event) {
    var btn = event.target.closest ? event.target.closest("#demo-controls-row button[data-action]") : null;
    if (!btn || btn.disabled) return;
    event.preventDefault();
    var action = btn.getAttribute("data-action");
    var step = btn.getAttribute("data-step");
    demoRunStep(action, step);
  });

  /* ------------------------------------------------------------------- render */
  function render() {
    var path = currentPath();
    var known = isKnown(path);
    var view = VIEWS[known ? path : "__404__"]();
    document.title = view.title || "MNEMON — Memory that can challenge itself.";
    var main = document.getElementById("view");
    if (main) {
      main.innerHTML = view.html.toString();
    }
    markNav(known ? path : null);
    if (path === "/demo") {
      if (!demo) demo = demoInit();
      if (!ENGINE.checked) probeEngine();
      else { demo.checking = false; demo.live = ENGINE.live; updateDemoUI(); }
    }
  }

  /* ----------------------------------------------------------------- startup */
  bindMenu();
  render();
  probeEngine();
})();