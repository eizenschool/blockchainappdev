const ROLE_CONTENT = {
  1: {
    eyebrow: "Shipper · Hospital supply coordinator",
    taskLabel: "Agreements requiring management",
    taskTab: "agreements",
    taskButton: "Manage agreements",
    secondaryTab: "create",
    secondaryButton: "Create agreement",
  },
  2: {
    eyebrow: "Carrier · Medical courier",
    taskLabel: "Deliveries requiring action",
    taskTab: "deliveries",
    taskButton: "Open deliveries",
    secondaryTab: "agreements",
    secondaryButton: "View all agreements",
  },
  3: {
    eyebrow: "Verifier · Receiving inspector",
    taskLabel: "Evidence ready for review",
    taskTab: "approvals",
    taskButton: "Open approvals",
    secondaryTab: "agreements",
    secondaryButton: "View all agreements",
  },
};

function getActionCount(role, agreements, chainTimestamp) {
  return agreements.filter(({ agreement, pickup, delivery }) => {
    const status = Number(agreement.status);
    const expired = chainTimestamp > Number(agreement.deadline);
    if (role === 1) {
      return (status === 1 && !expired) || ([0, 1, 2, 3].includes(status) && expired);
    }
    if (role === 2) {
      if (status === 0 && !expired) return true;
      if ([2, 3].includes(status) && expired) return true;
      if (status === 2 && !expired) return !pickup.evidenceCid;
      if (status === 3 && !expired) return !delivery.evidenceCid;
      return false;
    }
    if (role === 3 && !expired) {
      return (status === 2 && pickup.evidenceCid) || (status === 3 && delivery.evidenceCid);
    }
    return false;
  }).length;
}

export default function OverviewDashboard({ user, role, agreements, carrierStats, chainTimestamp, onRefresh, onNavigate }) {
  const content = ROLE_CONTENT[role];
  const current = agreements.filter(({ agreement }) => Number(agreement.status) <= 3).length;
  const actionCount = getActionCount(role, agreements, chainTimestamp);

  return (
    <div className="dashboard overview-dashboard">
      <section className="dashboard-heading">
        <div><p className="eyebrow">{content.eyebrow}</p><h1>Welcome back, {user.displayName}</h1></div>
        <button className="button button-secondary" type="button" onClick={onRefresh}>Refresh blockchain data</button>
      </section>

      <section className="stats-grid" aria-label="Wallet activity summary">
        <article><span>Total agreements</span><strong>{agreements.length}</strong></article>
        <article><span>Current</span><strong>{current}</strong></article>
        <article><span>{content.taskLabel}</span><strong>{actionCount}</strong></article>
      </section>

      {role === 2 && (
        <section className="stats-grid stats-grid-four reputation-summary" aria-label="Carrier factual reputation">
          <article><span>Assigned</span><strong>{agreements.length}</strong></article>
          <article><span>Milestones verified</span><strong>{carrierStats.verifiedMilestones.toString()}</strong></article>
          <article><span>Completed</span><strong>{carrierStats.completedAgreements.toString()}</strong></article>
          <article><span>Funded expiries</span><strong>{carrierStats.expiredFundedAgreements.toString()}</strong></article>
        </section>
      )}

      <section className="panel overview-actions">
        <div>
          <p className="eyebrow">Next step</p>
          <h2>{actionCount === 0 ? "Nothing needs immediate attention" : `${actionCount} ${actionCount === 1 ? "item needs" : "items need"} attention`}</h2>
          <p>{actionCount === 0 ? "You can review the complete on-chain record or prepare the next workflow step." : content.taskLabel}</p>
        </div>
        <div className="overview-buttons">
          <button className="button button-primary" type="button" onClick={() => onNavigate(content.taskTab)}>{content.taskButton}</button>
          <button className="button button-secondary" type="button" onClick={() => onNavigate(content.secondaryTab)}>{content.secondaryButton}</button>
        </div>
      </section>
    </div>
  );
}
