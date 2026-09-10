const LIFECYCLE = [
  { number: "01", title: "Create", detail: "The Shipper defines the route, escrow, deadline, payout split, Carrier, and Verifier." },
  { number: "02", title: "Accept", detail: "The Carrier reviews the delivery terms and accepts the assignment." },
  { number: "03", title: "Fund", detail: "The Shipper locks the exact amount of test ETH in the smart contract." },
  { number: "04", title: "Pickup evidence", detail: "The Carrier records an IPFS CID for the pickup photograph." },
  { number: "05", title: "Pickup approval", detail: "The Verifier checks the evidence and enters the pickup code, releasing the first payout." },
  { number: "06", title: "Delivery evidence", detail: "The Carrier records a second IPFS CID after reaching the hospital destination." },
  { number: "07", title: "Delivery approval", detail: "The Verifier checks the final evidence and enters the delivery code." },
  { number: "08", title: "Complete", detail: "The remaining escrow, including any rounding remainder, is released to the Carrier." },
];

const ROLES = [
  {
    marker: "S",
    title: "Shipper",
    subtitle: "Hospital supply coordinator",
    detail: "Creates the agreement, nominates the other wallets, funds the escrow, and privately gives both proof codes to the Verifier.",
  },
  {
    marker: "C",
    title: "Carrier",
    subtitle: "Medical courier",
    detail: "Accepts the delivery and submits the public IPFS evidence CID for each active milestone. The Carrier cannot approve its own evidence.",
  },
  {
    marker: "V",
    title: "Verifier",
    subtitle: "Receiving inspector",
    detail: "Reviews milestone evidence and supplies the matching one-time code. The Verifier cannot hold, withdraw, or redirect escrow funds.",
  },
];

function EscrowGuide() {
  return (
    <section className="guide-section" aria-labelledby="escrow-guide-title">
      <div className="guide-section-heading"><p className="eyebrow">Escrow lifecycle</p><h2 id="escrow-guide-title">Every payment follows a visible process</h2></div>
      <ol className="lifecycle-grid">
        {LIFECYCLE.map(({ number, title, detail }) => (
          <li key={number}>
            <span className="lifecycle-number">{number}</span>
            <div><h2>{title}</h2><p>{detail}</p></div>
          </li>
        ))}
      </ol>

      <section className="explanation-grid">
        <article className="information-card feature-card">
          <p className="eyebrow">Progressive payout</p>
          <h2>Funds move with verified progress</h2>
          <p>The Shipper chooses the pickup percentage. Pickup approval releases that portion, while delivery approval releases every remaining wei in escrow.</p>
          <div className="split-example" aria-label="Example payout split">
            <span style={{ width: "30%" }}>30% pickup</span>
            <span style={{ width: "70%" }}>70% delivery</span>
          </div>
        </article>
        <article className="information-card feature-card">
          <p className="eyebrow">Deadline protection</p>
          <h2>Unreleased funds can return</h2>
          <p>After the deadline, approval is blocked and any wallet may call the expiry function. The contract then returns unreleased escrow to the Shipper.</p>
          <p className="fine-print">A smart contract cannot wake itself on a timer. A wallet must submit the expiry transaction, after which the rules execute automatically.</p>
        </article>
      </section>

      <aside className="testnet-banner">
        <strong>Demonstration environment</strong>
        <span>ProofRoute runs on the local Hardhat network with test ETH. No real funds or live hospital deliveries are involved.</span>
      </aside>
    </section>
  );
}

function RolesGuide() {
  return (
    <section className="guide-section" aria-labelledby="roles-guide-title">
      <div className="guide-section-heading"><p className="eyebrow">Permissions and safeguards</p><h2 id="roles-guide-title">Three wallets, clearly separated responsibilities</h2><p>The contract checks which wallet may perform each action and rejects unauthorized or out-of-order transactions.</p></div>
      <section className="role-grid" aria-label="ProofRoute roles">
        {ROLES.map(({ marker, title, subtitle, detail }) => (
          <article className="information-card role-card" key={title}>
            <span className="role-marker" aria-hidden="true">{marker}</span>
            <p className="role-subtitle">{subtitle}</p>
            <h2>{title}</h2>
            <p>{detail}</p>
          </article>
        ))}
      </section>

      <section className="safety-section">
        <div>
          <p className="eyebrow">Public evidence</p>
          <h2>Use IPFS carefully</h2>
          <p>The blockchain stores only the CID, not the photograph. Anyone with that CID and a working gateway may still retrieve the public file.</p>
        </div>
        <ul className="safety-list">
          <li><strong>Keep personal data out.</strong><span>Do not upload faces, patient records, addresses, or other sensitive material.</span></li>
          <li><strong>Protect proof codes before use.</strong><span>The interface generates six-digit demonstration codes and creation stores only their hashes. A code becomes public when the Verifier submits it on-chain.</span></li>
          <li><strong>Understand the limits.</strong><span>IPFS proves that content matches a CID. It cannot prove that a photograph is truthful.</span></li>
          <li><strong>Know the prototype boundary.</strong><span>Short OTPs are not production authentication. The prototype supports deadline refunds but does not arbitrate contested claims.</span></li>
        </ul>
      </section>
    </section>
  );
}

export function Guide() {
  return (
    <div className="education-view">
      <header className="page-intro">
        <p className="eyebrow">ProofRoute guide</p>
        <h1>Understand the workflow before moving test ETH</h1>
        <p>The lifecycle, wallet permissions, evidence rules, and prototype limitations are collected in one place.</p>
      </header>
      <EscrowGuide />
      <RolesGuide />
    </div>
  );
}
