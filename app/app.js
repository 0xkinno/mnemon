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
  function raw(value) { var o = {}; o[RAW] = String(value); return o; }
  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function h(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) {
      var v = arguments[i];
      if (v && typeof v === "object" && v[RAW] !== undefined) out += v[RAW];
      else if (Array.isArray(v)) out += v.join("");
      else if (v === null || v === undefined || v === false || v === true) out += "";
      else out += esc(v);
      out += strings[i];
    }
    return out;
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
      return h`<tr><th scope="row">${item.label}</th><td><span class="vd">${item.value}</span><br><span class="muted">${item.detail}</span><br><span class="muted">source: <code>${item.artifact}</code></span></td><td><span class="badge" data-tone="${item.tone}">${item.tone === "ok" ? "verified" : item.tone}</span></td></tr>`;
    }).join("");
  }
  function evidenceTable(caption) {
    return h`<div class="scroll-x"><table class="tbl">
      <caption>${caption}</caption>
      <thead><tr><th scope="col">Check</th><th scope="col">Observed value</th><th scope="col">State</th></tr></thead>
      <tbody>${raw(evidenceRows())}</tbody>
    </table></div>`;
  }
  function proofIndexTable() {
    var rows = (SNAP.proof_index || []).map(function (item) {
      return h`<tr><th scope="row"><code>${item.name}</code></th><td>${short(item.sha256, 20, 12)}</td><td>${item.bytes} B</td></tr>`;
    }).join("");
    return h`<div class="scroll-x"><table class="tbl">
      <caption>Proof artifacts — content hashes</caption>
      <thead><tr><th scope="col">Artifact</th><th scope="col">sha256</th><th scope="col">Size</th></tr></thead>
      <tbody>${raw(rows)}</tbody>
    </table></div>`;
  }
  function verdictTable() {
    var rows = [
      ["CLEAN", "Current WARM value is bound to a matching durable witness and nothing in the same epoch contradicts it.", "Action may proceed", "ok"],
      ["CONTESTED", "Independent witnessed claims disagree for the same entity and epoch.", "Action blocked or escalated", "warn"],
      ["UNWITNESSED", "The current value cannot be tied to the required durable witness.", "Action blocked", "block"],
      ["INVALID", "Claim, hash, entity, epoch, or evidence binding is inconsistent.", "Action rejected", "block"]
    ].map(function (r) {
      return h`<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td><span class="badge" data-tone="${r[3]}">${r[2]}</span></td></tr>`;
    }).join("");
    return h`<div class="scroll-x"><table class="tbl">
      <caption>The four verdicts</caption>
      <thead><tr><th scope="col">Verdict</th><th scope="col">Meaning</th><th scope="col">Consequence</th></tr></thead>
      <tbody>${raw(rows)}</tbody>
    </table></div>`;
  }
  function ctaRow() {
    return h`<div class="btn-row" style="margin-top:28px">
      <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
      <a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a>
    </div>`;
  }  /* ------------------------------------------------------------------- views */
  var VIEWS = {};

  VIEWS["/"] = function () {
    var v = SNAP.verdict || {};
    var w = SNAP.cold_witness || {};
    return {
      title: "MNEMON — Memory that can challenge itself.",
      html: h`
      <section class="section">
        <div class="grid" style="grid-template-columns:1.12fr .88fr;gap:56px;align-items:end">
          <div>
            <div class="eyebrow">Memory assurance for autonomous systems</div>
            <h1>Memory that can challenge itself.</h1>
            <p class="lede">Before an autonomous system acts, MNEMON checks whether its current memory is actually witnessed.</p>
            <div class="chips" style="margin-top:26px">
              <span class="chip">sibyl-memory-client ${SNAP.sibyl_version}</span>
              <span class="chip">Virtuals ACP job ${SNAP.acp_job_id}</span>
              <span class="chip">${SNAP.base_commitment.network} anchor</span>
            </div>
            ${raw(ctaRow())}
          </div>
          <aside class="card" aria-label="Latest verified MNEMON decision">
            <div class="label">Latest verified decision</div>
            <div class="verdict" data-tone="${tone(v.status)}">${v.status}</div>
            <p class="why" style="color:var(--panelsoft);max-width:34ch">The surviving value is bound to a durable witness and no witnessed claim conflicts with it.</p>
            <dl style="margin-top:16px">
              <div class="row"><dt>Durable witness (COLD)</dt><dd>${w.writer_id}</dd></div>
              <div class="row"><dt>Witness epoch</dt><dd>${w.epoch_id}</dd></div>
              <div class="row"><dt>Decision hash</dt><dd>${short(w.claim_hash, 18, 8)}</dd></div>
              <div class="row"><dt>Consequence</dt><dd>${v.action}</dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <section class="section" id="why">
        <div class="kicker">Why MNEMON</div>
        <h2>A current value is not a settled truth.</h2>
        <p class="note">Autonomous systems read the latest memory value and act. That is fine until two independent processes observe incompatible states, a workflow crashes between writes, or a retry repeats an operation. Then the surviving value looks healthy and is not.</p>
        <div class="cards g3">
          <div class="cell"><div class="n">01</div><h3>The gap</h3><p>WARM keeps one current row per entity. COLD keeps the journal. The current row does not expose the contention that produced it.</p></div>
          <div class="cell"><div class="n">02</div><h3>The boundary</h3><p>MNEMON reconciles the current value against the durable journal before anything downstream is allowed to run.</p></div>
          <div class="cell"><div class="n">03</div><h3>The consequence</h3><p>Only a witnessed, uncontested value proceeds. Everything else fails closed and the action is blocked.</p></div>
        </div>
      </section>

      <section class="section" id="contradiction">
        <div class="kicker">The memory contradiction</div>
        <h2>Two witnesses, one surviving value.</h2>
        <p class="note">A naive reader sees the last write and acts on it. MNEMON sees that the surviving value was never the only claim.</p>
        <div class="contradiction">
          <div class="witness"><div class="who">Watcher A</div><div class="val" data-tone="ok">SAFE</div><div class="why">Committed to the journal in the contested epoch.</div></div>
          <div class="witness"><div class="who">Watcher B</div><div class="val" data-tone="block">CRITICAL</div><div class="why">Committed to the journal in the same epoch, contradicting A.</div></div>
          <div class="merge"><div class="who">MNEMON</div><div class="val" data-tone="warn">CONTESTED</div><div class="btn-row" style="margin-top:6px"><span class="badge" data-tone="block">Action blocked</span></div><p class="why" style="margin-top:14px">Two valid, conflicting witnesses exist for the same entity and epoch, so the current value is not settled truth.</p></div>
        </div>
      </section>

      <section class="section" id="verdicts">
        <div class="kicker">Four verdict states</div>
        <h2>One invariant, four outcomes.</h2>
        <p class="note">A consequential decision may be marked CLEAN only when the current WARM claim is bound to a valid durable COLD witness for the same entity and epoch, and no unresolved conflicting witnessed claim exists. Everything else fails closed.</p>
        ${raw(verdictTable())}
      </section>

      <section class="section" id="how">
        <div class="kicker">How it works</div>
        <h2>Four steps on the critical path.</h2>
        <p class="note">Each step reads or writes real Sibyl Memory. Nothing in the sequence is decorative.</p>
        <div class="cards g4">
          <div class="cell"><div class="n">01</div><h3>Current memory</h3><p>A single WARM value exists per entity. It is fast, unique, and gives no hint of contention.</p></div>
          <div class="cell"><div class="n">02</div><h3>Durable witness</h3><p>The COLD journal keeps every committed claim with its writer, epoch, and exact claim hash.</p></div>
          <div class="cell"><div class="n">03</div><h3>MNEMON verdict</h3><p>MNEMON reconciles the current value against the journal before anything else is allowed to run.</p></div>
          <div class="cell"><div class="n">04</div><h3>Consequence</h3><p>Only a witnessed, uncontested value may proceed. Everything else fails closed.</p></div>
        </div>
      </section>

      <section class="section" id="proof">
        <div class="kicker">Live proof</div>
        <h2>Every claim carries a hash.</h2>
        <p class="note">The values below are read from verified run artifacts in <code>proof/</code>. The claim hash the ACP resolution produced is the same value stored as the Sibyl COLD witness and committed by the Base transaction.</p>
        ${raw(evidenceTable("Verified run evidence"))}
      </section>

      <section class="section" id="demo-cta">
        <div class="card" style="display:grid;grid-template-columns:1.2fr .8fr;gap:32px;align-items:center">
          <div>
            <div class="label">Interactive demo</div>
            <h2 style="color:var(--panelink);margin-top:14px">Operate the contradiction yourself.</h2>
            <p class="why" style="color:var(--panelsoft);max-width:56ch">Run the contention proof, verify a fresh process, delete the memory layer, and watch the verdict move between CONTESTED, UNWITNESSED and CLEAN. Every value comes from the engine or from a recorded verified run.</p>
          </div>
          <div class="btn-row">
            <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo" style="background:#f2f2ec;color:#151714;border-color:#f2f2ec">Open live demo</a>
            <a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence" style="background:transparent;color:#f2f2ec;border-color:#4a4f46">See the proof</a>
          </div>
        </div>
      </section>

      <section class="section" id="architecture-teaser">
        <div class="kicker">Architecture</div>
        <h2>Where the boundary sits.</h2>
        <p class="note">Observers write claims into Sibyl Memory. MNEMON reconciles WARM against COLD. Only a CLEAN verdict reaches a consequential action, and unresolved contention is escalated to Virtuals ACP.</p>
        <div class="btn-row"><a class="btn" href="${href("/architecture")}" data-nav data-path="/architecture">Read the architecture</a></div>
      </section>

      <section class="section" id="final-cta">
        <div class="kicker">Close</div>
        <h2>Unsafe confidence should be impossible to hide.</h2>
        <p class="note">MNEMON is not trying to make failure impossible. It is making an unwarranted CLEAN impossible to reach.</p>
        ${raw(ctaRow())}
      </section>`
    };
  };

  VIEWS["/product"] = function () {
    return {
      title: "Product — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Product</div>
        <h1>A memory-consistency boundary for autonomous systems.</h1>
        <p class="lede">MNEMON sits between the memory an agent reads and the action it takes, and it refuses to authorise an action the memory cannot justify.</p>
        <div class="btn-row" style="margin-top:28px">
          <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
          <a class="btn" href="${href("/architecture")}" data-nav data-path="/architecture">Architecture</a>
        </div>
      </section>

      <section class="section">
        <div class="kicker">What it is</div>
        <h2>Two tiers, one decision.</h2>
        <div class="cards g2">
          <div class="cell"><div class="n">WARM</div><h3>Current value</h3><p>The fast path. One row per entity, used for immediate decisions. It has uniqueness semantics and no contention history.</p></div>
          <div class="cell"><div class="n">COLD</div><h3>Durable witness</h3><p>The journal. Every committed claim with writer, epoch, evidence, and the exact claim hash of its canonical payload.</p></div>
        </div>
        <p class="note" style="margin-top:28px">A claim is canonically represented with <code>operation_id</code>, <code>entity_key</code>, <code>epoch_id</code>, <code>writer_id</code>, <code>claim_hash</code> and <code>evidence_refs</code>. The hash binds the verdict to the exact payload rather than to an opaque label.</p>
      </section>

      <section class="section">
        <div class="kicker">Who it is for</div>
        <h2>Systems that act on memory they did not personally witness.</h2>
        <div class="cards g3">
          <div class="cell"><div class="n">01</div><h3>Trading and risk agents</h3><p>A risk verdict that flips between SAFE and CRITICAL across processes must not silently settle.</p></div>
          <div class="cell"><div class="n">02</div><h3>Long-running workflows</h3><p>A crash between a state write and its witness must not leave a value that looks authoritative.</p></div>
          <div class="cell"><div class="n">03</div><h3>Multi-agent systems</h3><p>Independent workers write competing observations for the same entity; only one survives in the current row.</p></div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Hard invariant</div>
        <h2>The rule that everything else fails closed against.</h2>
        <p class="note" style="font-size:17px;color:var(--ink);border-left:2px solid var(--ink);padding-left:18px">A consequential decision may be marked CLEAN only when the current WARM claim is bound to a valid durable COLD witness for the same entity and epoch, and no unresolved conflicting witnessed claim exists.</p>
        ${raw(verdictTable())}
      </section>

      <section class="section">
        <div class="kicker">Boundaries</div>
        <h2>What MNEMON is not.</h2>
        <div class="cards g3">
          <div class="cell"><div class="n">Not a cache</div><h3>Not a notepad</h3><p>Deleting the memory layer removes the ability to decide. Nothing else substitutes for the witness.</p></div>
          <div class="cell"><div class="n">Not a lock</div><h3>Not a mutex</h3><p>MNEMON does not prevent concurrent writers. It prevents a contested result from being treated as settled.</p></div>
          <div class="cell"><div class="n">Not a badge</div><h3>Not partner theatre</h3><p>ACP is invoked only for a genuinely unresolved CONTESTED case, and its result is persisted as a witness like any other.</p></div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Next</div>
        <h2>Operate it, then read the proof.</h2>
        <div class="btn-row"><a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a><a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a><a class="btn" href="${href("/docs")}" data-nav data-path="/docs">Docs</a></div>
      </section>`
    };
  };  VIEWS["/architecture"] = function () {
    return {
      title: "Architecture — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Architecture</div>
        <h1>Where the boundary sits.</h1>
        <p class="lede">Observers write claims. MNEMON reconciles the current value against the durable journal. Only a clean, witnessed value reaches a consequential action.</p>
      </section>

      <section class="section">
        <div class="kicker">Reconciliation</div>
        <h2>The path a decision takes.</h2>
        <div class="cards g4">
          <div class="cell"><div class="n">01</div><h3>Observers</h3><p>Independent processes build canonical claims and write them to Sibyl Memory.</p></div>
          <div class="cell"><div class="n">02</div><h3>Sibyl Memory</h3><p>WARM holds the current row. COLD holds the committed witness for every claim.</p></div>
          <div class="cell"><div class="n">03</div><h3>MNEMON arbiter</h3><p>Binds entity, epoch and claim hash, then reconciles the two tiers.</p></div>
          <div class="cell"><div class="n">04</div><h3>Consequence</h3><p>CLEAN proceeds. CONTESTED escalates or blocks. UNWITNESSED and INVALID block.</p></div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Decision sequence</div>
        <h2>Contested cases are escalated, then persisted.</h2>
        <div class="capsule">
          <div>observer A ── write claim + witness ──► Sibyl COLD</div>
          <div>observer B ── write competing claim + witness ──► Sibyl COLD</div>
          <div>MNEMON ── read WARM current state ──► single surviving value</div>
          <div>MNEMON ── read COLD witnesses ──► contention detected</div>
          <div>MNEMON ── reconcile ──► CONTESTED · ACTION BLOCKED</div>
          <div>MNEMON ── escalate ──► Virtuals ACP adjudication</div>
          <div>Virtuals ACP ── verified deliverable ──► Sibyl COLD witness</div>
          <div>MNEMON ── recompute ──► CLEAN · ACTION ALLOWED</div>
          <div>MNEMON ── commit ──► Base anchor · verified receipt</div>
        </div>
      </section>

      <section class="section">
        <div class="kicker">Failure engineering</div>
        <h2>Every unsafe condition fails closed.</h2>
        <p class="note">MNEMON is designed around falsification. The goal is not to make failure impossible; it is to make an unwarranted CLEAN impossible to reach.</p>
        <div class="scroll-x"><table class="tbl">
          <caption>Attack surface</caption>
          <thead><tr><th scope="col">Condition</th><th scope="col">Expected result</th></tr></thead>
          <tbody>
            <tr><th scope="row">Concurrent writers</th><td>CONTESTED</td></tr>
            <tr><th scope="row">Crash during workflow</th><td>No unsafe CLEAN</td></tr>
            <tr><th scope="row">Retry</th><td>Idempotent handling</td></tr>
            <tr><th scope="row">Duplicate witness</th><td>Safe duplicate handling</td></tr>
            <tr><th scope="row">Wrong entity / wrong epoch</th><td>UNWITNESSED</td></tr>
            <tr><th scope="row">Tampered claim or hash</th><td>INVALID</td></tr>
            <tr><th scope="row">Missing witness</th><td>UNWITNESSED</td></tr>
            <tr><th scope="row">Deleted memory</th><td>UNWITNESSED + blocked</td></tr>
            <tr><th scope="row">Fresh process</th><td>State reconstructed from persistence</td></tr>
            <tr><th scope="row">Replayed ACP result</th><td>Safe rejection / duplicate recognition</td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="section">
        <div class="kicker">Components</div>
        <h2>What runs where.</h2>
        <div class="scroll-x"><table class="tbl">
          <caption>Component map</caption>
          <thead><tr><th scope="col">Component</th><th scope="col">Role</th><th scope="col">Surface</th></tr></thead>
          <tbody>
            <tr><th scope="row"><code>mnemon/</code></th><td>Witnessed memory, canonical claims, arbiter.</td><td>Local engine</td></tr>
            <tr><th scope="row"><code>experiments/</code></th><td>Proof runners that produce every artifact in <code>proof/</code>.</td><td>Local engine</td></tr>
            <tr><th scope="row"><code>scripts/acp_*.ts</code></th><td>Buyer/evaluator runner, independent inspection, deliverable pre-flight and provider submit path.</td><td>Local engine</td></tr>
            <tr><th scope="row"><code>scripts/demo_api.py</code></th><td>Instrument API. Wraps the real engine; runs contention, deletion, restore and fresh-process checks on demand.</td><td>Local instrument</td></tr>
            <tr><th scope="row"><code>scripts/responsive.mjs</code></th><td>Structural gate: six viewports, six routes, overflow, labels, text size, and a live click-through of the navbar and the demo controls.</td><td>Local check</td></tr>
<tr><th scope="row"><code>app/</code></th><td>This product surface: a client-side router with six views, an inlined snapshot verified at build time, and the demo instrument.</td><td>Public</td></tr>
          </tbody>
        </table></div>
        <div class="btn-row" style="margin-top:28px"><a class="btn" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a><a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a></div>
      </section>`
    };
  };

  VIEWS["/evidence"] = function () {
    var b = SNAP.base_commitment;
    var a = SNAP.acp;
    var w = SNAP.cold_witness;
    return {
      title: "Evidence — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Evidence</div>
        <h1>Binding, not coexistence.</h1>
        <p class="lede">Every hop in the chain carries the same decision hash. The values below are read from verified run artifacts, and the build fails if this page drifts from them.</p>
        <div class="btn-row" style="margin-top:28px">
          <a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a>
          <a class="btn" href="${href("/architecture")}" data-nav data-path="/architecture">Architecture</a>
        </div>
      </section>

      <section class="section" id="chain">
        <div class="kicker">The chain</div>
        <h2>ACP result → Sibyl COLD → verdict → Base.</h2>
        <div class="scroll-x"><table class="tbl">
          <caption>Linked identifiers</caption>
          <thead><tr><th scope="col">Hop</th><th scope="col">Value</th></tr></thead>
          <tbody>
            <tr><th scope="row">Entity</th><td>${SNAP.entity_key}</td></tr>
            <tr><th scope="row">Contested epoch</th><td>${SNAP.epoch_id}</td></tr>
            <tr><th scope="row">ACP job</th><td>${a.job_id} · ${a.final_onchain_status} · ${a.offering}</td></tr>
            <tr><th scope="row">Deliverable digest (sha256)</th><td>${a.deliverable_digest}</td></tr>
            <tr><th scope="row">On-chain submitted hash (keccak256)</th><td>${a.onchain_submitted_hash}</td></tr>
            <tr><th scope="row">COLD witness operation</th><td>${w.operation_id} · writer ${w.writer_id}</td></tr>
            <tr><th scope="row">COLD witness claim hash</th><td>${w.claim_hash}</td></tr>
            <tr><th scope="row">Base transaction</th><td><a href="${b.explorer}" rel="noopener">${b.tx_hash}</a></td></tr>
            <tr><th scope="row">Base block</th><td>${b.block_number}</td></tr>
            <tr><th scope="row">Linkage status</th><td><span class="badge" data-tone="${SNAP.linkage_verified ? "ok" : "block"}">${SNAP.linkage_verified ? "verified" : "unverified"}</span></td></tr>
          </tbody>
        </table></div>
      </section>

      <section class="section" id="panel">
        <div class="kicker">Evidence panel</div>
        <h2>Every check, and where it comes from.</h2>
        ${raw(evidenceTable("Experiment results"))}
      </section>

      <section class="section" id="artifacts">
        <div class="kicker">Artifacts</div>
        <h2>The proof index.</h2>
        <p class="note">Hashes are recomputed from <code>proof/</code> when the snapshot is generated, so a changed artifact changes this table.</p>
        ${raw(proofIndexTable())}
      </section>

      <section class="section" id="external">
        <div class="kicker">External</div>
        <h2>Inspect it yourself.</h2>
        <div class="btn-row">
          <a class="btn" href="${b.explorer}" rel="noopener">Open Base receipt</a>
          <a class="btn" href="${SNAP.contract_explorer || b.explorer}" rel="noopener">Open contract</a>
          <a class="btn" href="${href("/docs")}" data-nav data-path="/docs">Reproduce locally</a>
        </div>
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
    }).join("");
    return {
      title: "Docs — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Docs</div>
        <h1>Run it, then check it.</h1>
        <p class="lede">Everything on this site is reproducible from the repository. The instrument runs the real engine against real Sibyl Memory.</p>
      </section>

      <section class="section">
        <div class="kicker">Quickstart</div>
        <h2>Five commands.</h2>
        <div class="capsule">
          <div>python -m venv .venv</div>
          <div>.venv\\Scripts\\Activate.ps1</div>
          <div>python -m pip install -r requirements.txt</div>
          <div>python -m pytest -q</div>
          <div>python scripts/demo_api.py</div>
        </div>
        <p class="note" style="margin-top:22px">The last command serves this site at <code>http://127.0.0.1:8080</code> together with the instrument API. Open <code>/demo</code> to operate the real engine. Without that command the site falls back to the recorded verified run and says so.</p>
      </section>

      <section class="section">
        <div class="kicker">Reproduce the evidence</div>
        <h2>Rebuild the snapshot.</h2>
        <div class="capsule">
          <div>python experiments/final_e2e_chain.py</div>
          <div>python experiments/final_controls.py</div>
          <div>python experiments/app_evidence.py</div>
          <div>npm run build</div>
        </div>
        <p class="note" style="margin-top:22px">The first two re-read the live database and the Base Sepolia receipt. The build gate fails if this page has drifted from <code>proof/</code>.</p>
      </section>

      <section class="section">
        <div class="kicker">Deliverable contract</div>
        <h2>What a provider may submit.</h2>
        <p class="note">The evaluator accepts a deliverable only when it parses as JSON and every one of <code>decision</code>, <code>winning_claim</code>, <code>reason_code</code>, <code>evidence_digest</code> and <code>adjudicated_at</code> is a non-empty string. The provider pre-flight enforces the same rule before submission.</p>
      </section>

      <section class="section">
        <div class="kicker">Document index</div>
        <h2>Where to read more.</h2>
        <div class="scroll-x"><table class="tbl">
          <caption>Repository documents</caption>
          <thead><tr><th scope="col">Document</th><th scope="col">Contents</th></tr></thead>
          <tbody>${raw(docs)}</tbody>
        </table></div>
      </section>

      <section class="section">
        <div class="kicker">Instrument</div>
        <h2>Operate it.</h2>
        <div class="btn-row"><a class="btn btn-primary" href="${href("/demo")}" data-nav data-path="/demo">Open live demo</a><a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">See the proof</a></div>
      </section>`
    };
  };  /* -------------------------------------------------------------------- demo */
  var STAGES = [
    { id: "observe", label: "Observe" },
    { id: "reconcile", label: "Reconcile" },
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

  function nextAction() {
    if (!demo) return null;
    var pending = demo.sequence.filter(function (id) { return demo.revealed.indexOf(id) === -1; });
    return pending.length ? pending[0] : null;
  }

  function stageStrip(activeStage) {
    return STAGES.map(function (s, i) {
      return h`<div class="st" data-active="${s.id === activeStage ? "true" : "false"}"><div class="k">${String(i + 1).padStart(2, "0")} ${s.label}</div></div>`;
    }).join("");
  }

  function stepCard(step) {
    var cold = (step.cold || []).map(function (c) {
      return h`<div class="why" style="margin-bottom:10px"><span class="badge" data-tone="${tone(c.status)}">${c.status}</span> <code>${short(c.claim_hash, 16, 8)}</code><br><span class="muted">${c.writer_id} · ${c.epoch_id} · ${c.operation_id}</span></div>`;
    }).join("");
    var warmBlock = step.warm
      ? h`<div class="v">${step.warm.status}</div><div class="why" style="margin-top:8px">${step.warm.writer_id} · ${step.warm.epoch_id}<br><code>${short(step.warm.claim_hash, 16, 8)}</code></div>`
      : h`<div class="v">—</div><div class="why" style="margin-top:8px">No current value.</div>`;
    var coldBlock = cold
      ? h`<div style="margin-top:10px">${raw(cold)}</div>`
      : h`<div class="v">0</div><div class="why" style="margin-top:8px">No committed witness remains.</div>`;
    return h`<article class="section" style="padding-top:34px" aria-labelledby="step-${step.id}">
      <div class="kicker">${step.stage} · ${step.label}</div>
      <h2 id="step-${step.id}" style="font-size:26px">${step.title}</h2>
      <div class="state">
        <div><div class="k">WARM · current</div>${raw(warmBlock)}</div>
        <div><div class="k">COLD · witnesses (${(step.cold || []).length})</div>${raw(coldBlock)}</div>
        <div><div class="k">MNEMON verdict</div><div class="vd" style="margin-top:10px;font-family:var(--serif);font-size:24px" data-tone="${tone(step.verdict)}">${step.verdict}</div></div>
        <div><div class="k">Action</div><div style="margin-top:10px"><span class="ac" style="display:inline-block;padding:6px 10px;border-radius:2px;font-family:var(--mono);font-size:12px" data-tone="${step.action === "ALLOWED" ? "ok" : "block"}">${step.action}</span></div></div>
      </div>
      <p class="why" style="margin-top:14px">${step.note}</p>
      <p class="why" style="margin-top:6px">source: <code>${step.artifact}</code></p>
    </article>`;
  }

  function logMarkup() {
    if (!demo || !demo.log || !demo.log.length) return h`<p class="why">No operations yet.</p>`;
    return demo.log.map(function (e) {
      return h`<div class="entry" data-tone="${e.tone || ""}"><div class="t">${e.t}</div><div class="m">${e.m}</div></div>`;
    }).join("");
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
    }).join("");
    return buttons + '<button class="btn btn-sm" type="button" data-action="reset" data-step="__reset">Reset run</button>';
  }

  function demoStatusLine() {
    if (demo.checking) return h`<span class="dot"></span>checking for the live instrument…`;
    if (demo.error) return h`<span class="dot" data-tone="block"></span>${demo.error}`;
    if (demo.busy) return h`<span class="dot" data-tone="warn"></span>running ${demo.busy}…`;
    if (demo.live) return h`<span class="dot" data-tone="ok"></span>live engine connected — operations run against real Sibyl Memory`;
    return h`<span class="dot"></span>recorded verified run — start <code>python scripts/demo_api.py</code> for live execution`;
  }

  VIEWS["/demo"] = function () {
    if (!demo) demo = demoInit();
    var b = SNAP.base_commitment;
    var steps = demo.revealed.map(function (id) { return stepCard(demo.steps[id]); }).join("");
    return {
      title: "Demo — MNEMON",
      html: h`
      <section class="section">
        <div class="eyebrow">Interactive demo</div>
        <h1>Operate the contradiction.</h1>
        <p class="lede">Run the contention proof, verify a fresh process, delete the memory layer, and restore it. The verdict and the action follow the engine, not the copy on this page.</p>
        <div class="bar" style="margin-top:28px">
          <div id="demo-status" role="status" aria-live="polite" class="why" style="font-family:var(--mono);font-size:12px">${raw(demoStatusLine())}</div>
          <div class="badge" data-tone="${demo.live ? "ok" : ""}" id="demo-mode">${demo.mode === "live" ? "live engine" : "recorded run"}</div>
        </div>
        <div class="stage">${raw(stageStrip(nextAction() ? demo.steps[nextAction()].stage : "action"))}</div>
      </section>

      <section class="section" id="demo-controls">
        <div class="kicker">Controls</div>
        <h2>Run the verified capabilities.</h2>
        <div class="btn-row" id="demo-controls-row" role="group" aria-label="Demo operations">${raw(controlsMarkup())}</div>
        <p class="why" style="margin-top:14px">Buttons are enabled only when the previous step in the sequence has completed. Every operation reports what the engine actually returned.</p>
      </section>

      <section class="section" id="demo-inspect">
        <div class="kicker">Inspect</div>
        <h2>Follow the evidence.</h2>
        <div class="btn-row">
          <button class="btn btn-sm" type="button" data-action="inspect-evidence">Inspect evidence</button>
          <a class="btn btn-sm" href="${href("/evidence")}" data-nav data-path="/evidence">Inspect proof</a>
          <a class="btn btn-sm" href="${b.explorer}" rel="noopener">Open Base evidence</a>
          <a class="btn btn-sm" href="${href("/evidence")}" data-nav data-path="/evidence">Open ACP evidence</a>
        </div>
      </section>

      <div id="demo-timeline">${raw(steps)}</div>

      <section class="section" id="demo-log-section">
        <div class="kicker">Runtime log</div>
        <h2>What the instrument did.</h2>
        <div class="log" id="demo-log" role="log" aria-live="polite">${raw(logMarkup())}</div>
      </section>

      <section class="section" id="demo-evidence">
        <div class="kicker">Evidence</div>
        <h2>The identifiers this run carries.</h2>
        ${raw(evidenceTable("Run evidence"))}
        <div class="btn-row" style="margin-top:26px"><a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">Full evidence page</a></div>
      </section>`
    };
  };

  function paintDemo() {
    var status = document.getElementById("demo-status");
    if (status) status.innerHTML = demoStatusLine();
    var mode = document.getElementById("demo-mode");
    if (mode) { mode.textContent = demo.mode === "live" ? "live engine" : "recorded run"; mode.setAttribute("data-tone", demo.live ? "ok" : ""); }
    var controls = document.getElementById("demo-controls-row");
    if (controls) controls.innerHTML = controlsMarkup();
    var stage = document.querySelector("#view .stage");
    if (stage) stage.innerHTML = stageStrip(nextAction() ? demo.steps[nextAction()].stage : "action");
    var timeline = document.getElementById("demo-timeline");
    if (timeline) timeline.innerHTML = demo.revealed.map(function (id) { return stepCard(demo.steps[id]); }).join("");
    var log = document.getElementById("demo-log");
    if (log) log.innerHTML = logMarkup();
  }

  function applyStep(step) {
    if (demo.revealed.indexOf(step.id) === -1) demo.revealed.push(step.id);
    demo.steps[step.id] = step;
  }
  function revealedFor(stepId) {
    var idx = demo.sequence.indexOf(stepId);
    if (idx <= 0) return true;
    for (var i = 0; i < idx; i++) if (demo.revealed.indexOf(demo.sequence[i]) === -1) return false;
    return true;
  }
  function verdictTone(v) { return v === "CLEAN" ? "ok" : v === "CONTESTED" ? "warn" : "block"; }

  function resetLive() {
    // In live mode the engine state has to be rewound too, not just the view.
    fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset" })
    }).then(function (res) {
      return res.json();
    }).then(function (body) {
      if (body && body.ok && body.step) { applyStep(body.step); paintDemo(); }
      else if (body && body.error) { logPush("block", "Reset refused: " + body.error); paintDemo(); }
    }).catch(function (err) {
      logPush("block", "Reset failed: " + String(err && err.message ? err.message : err));
      paintDemo();
    });
  }

  function runRecorded(action, stepId) {
    var step = demo.steps[stepId];
    if (!step) {
      demo.error = "Recorded step " + stepId + " is missing from the snapshot.";
      logPush("block", "Refused: no recorded step for " + action + ".");
      return Promise.resolve();
    }
    applyStep(step);
    logPush(verdictTone(step.verdict), "Recorded " + action + " → MNEMON " + step.verdict + " · action " + step.action + " (source " + step.artifact + ")");
    return Promise.resolve();
  }

  function runLive(action) {
    return fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: action })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (out) {
      if (!out.ok || !out.body || out.body.ok !== true) {
        throw new Error((out.body && (out.body.error || out.body.message)) || "instrument returned an error");
      }
      applyStep(out.body.step);
      logPush(verdictTone(out.body.step.verdict),
        "Live " + action + " → MNEMON " + out.body.step.verdict + " · action " + out.body.step.action +
        (out.body.elapsed_ms ? " · " + out.body.elapsed_ms + " ms" : ""));
    }).catch(function (err) {
      demo.error = String(err && err.message ? err.message : err);
      logPush("block", "Failed: " + demo.error);
    });
  }

  function handleDemoClick(event) {
    var button = event.target.closest ? event.target.closest("button[data-action]") : null;
    if (!button) return;
    var action = button.getAttribute("data-action");
    if (action === "inspect-evidence") {
      var target = document.getElementById("demo-evidence");
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (demo.busy) return;
    if (action === "reset") {
      demo.revealed = demo.sequence.slice(0, 1);
      demo.log = [];
      demo.error = null;
      if (demo.live) resetLive();
      logPush("", "Run reset to the " + demo.sequence[0] + " state.");
      paintDemo();
      return;
    }
    var stepId = button.getAttribute("data-step");
    if (!revealedFor(stepId)) {
      logPush("block", "Refused: complete the earlier steps first.");
      paintDemo();
      return;
    }
    demo.error = null;
    demo.busy = action;
    button.setAttribute("aria-busy", "true");
    paintDemo();
    var work = demo.live ? runLive(action) : runRecorded(action, stepId);
    work.then(function () {
      demo.busy = null;
      paintDemo();
    });
  }

  function afterDemo() {
    if (!demo) demo = demoInit();
    var host = document.getElementById("view");
    host.addEventListener("click", handleDemoClick);
    if (demo.mode !== null) { paintDemo(); return; }
    demo.checking = true;
    paintDemo();
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 2500);
    fetch("/api/status", { signal: controller ? controller.signal : undefined })
      .then(function (res) { if (!res.ok) throw new Error("no instrument"); return res.json(); })
      .then(function (body) {
        if (!body || body.live !== true) throw new Error("instrument not live");
        demo.live = true;
        demo.mode = "live";
        if (body.steps) body.steps.forEach(function (s) { demo.steps[s.id] = s; });
        if (body.sequence && body.sequence.length) {
          demo.sequence = body.sequence.slice();
          demo.revealed = [body.sequence[0]];
        }
        logPush("ok", "Connected to the live instrument. Operations now run against real Sibyl Memory.");
      })
      .catch(function () {
        demo.mode = "recorded";
        logPush("", "Instrument API not reachable — showing the recorded verified run.");
      })
      .then(function () {
        clearTimeout(timer);
        demo.checking = false;
        paintDemo();
      });
  }

  /* ------------------------------------------------------------------ render */
  function setNav(active) {
    markNav(active);
  }
  function render() {
    var path = currentPath();
    closeMenu();
    var host = document.getElementById("view");
    if (!isKnown(path)) {
      setNav(null);
      document.title = "Not found — MNEMON";
      host.innerHTML = h`
        <section class="section">
          <div class="eyebrow">404</div>
          <h1>That route does not exist.</h1>
          <p class="lede">This surface has six destinations. Pick one below.</p>
          <div class="btn-row" style="margin-top:28px">
            <a class="btn btn-primary" href="${href("/")}" data-nav data-path="/">Home</a>
            <a class="btn" href="${href("/demo")}" data-nav data-path="/demo">Demo</a>
            <a class="btn" href="${href("/evidence")}" data-nav data-path="/evidence">Evidence</a>
          </div>
        </section>`;
      return;
    }
    setNav(path);
    var view = VIEWS[path]();
    document.title = view.title;
    host.innerHTML = view.html;
    if (path === "/demo") afterDemo();
  }

  function boot() {
    bindMenu();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();