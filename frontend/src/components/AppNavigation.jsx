export default function AppNavigation({ activeTab, onChange, tabs }) {
  const handleKeyDown = (event) => {
    const currentIndex = tabs.findIndex(({ id }) => id === activeTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    onChange(tabs[nextIndex].id);
    document.getElementById(`tab-${tabs[nextIndex].id}`)?.focus();
  };

  return (
    <nav className="primary-nav" aria-label="ProofRoute sections">
      <div className="tab-list" role="tablist" aria-label="Application views" onKeyDown={handleKeyDown}>
        {tabs.map(({ id, label }) => (
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
