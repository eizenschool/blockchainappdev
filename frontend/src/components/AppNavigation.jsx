const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "how-it-works", label: "How escrow works" },
  { id: "roles-safety", label: "Roles & safety" },
];

export default function AppNavigation({ activeTab, onChange }) {
  const handleKeyDown = (event) => {
    const currentIndex = TABS.findIndex(({ id }) => id === activeTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    onChange(TABS[nextIndex].id);
    document.getElementById(`tab-${TABS[nextIndex].id}`)?.focus();
  };

  return (
    <nav className="primary-nav" aria-label="ProofRoute sections">
      <div className="tab-list" role="tablist" aria-label="Application views" onKeyDown={handleKeyDown}>
        {TABS.map(({ id, label }) => (
          <button
            id={`tab-${id}`}
            className={`nav-tab ${activeTab === id ? "active" : ""}`}
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
