document.addEventListener("DOMContentLoaded", () => {
  const revealElements = document.querySelectorAll(".reveal");

  const revealOptions = {
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        observer.unobserve(entry.target);
      }
    });
  }, revealOptions);

  revealElements.forEach(el => {
    revealObserver.observe(el);
  });

  // Modal handling
  const setupModal = () => {
    // Check if modal already exists to prevent duplicates
    if (document.getElementById('signin-modal')) return;

    const modalHTML = `
      <div class="modal-overlay" id="signin-modal">
        <div class="modal-content relative" style="position: relative;">
          <button class="modal-close" onclick="closeModal()">
            <i data-lucide="x" style="width: 24px; height: 24px;"></i>
          </button>
          <div style="text-align: center; margin-bottom: 2rem;">
            <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Access Runtime</h2>
            <p style="color: var(--text-secondary); font-size: 0.9rem;">Authenticate to connect your graph store</p>
          </div>
          
          <form onsubmit="event.preventDefault(); window.location.href='runtime.html';">
            <div style="margin-bottom: 1.5rem;">
              <label style="display: block; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 500;">Email</label>
              <input type="email" required style="width: 100%; padding: 0.75rem 1rem; border: 1px solid var(--border-color); border-radius: 4px; font-family: var(--font-sans);" placeholder="name@company.com">
            </div>
            <button type="submit" class="btn btn-primary w-full" style="padding: 0.85rem; font-size: 0.95rem;">Authenticate</button>
          </form>
          
          <div style="margin-top: 1.5rem; text-align: center;">
            <span style="color: var(--text-secondary); font-size: 0.85rem;">or</span>
            <button onclick="window.location.href='runtime.html'" style="background: none; border: none; color: var(--accent-charcoal); font-weight: 500; cursor: pointer; font-size: 0.9rem; text-decoration: underline; margin-left: 0.5rem;">Continue as Guest</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    if(window.lucide) lucide.createIcons();
  };

  // Make functions globally available
  window.openModal = (e) => {
    if(e) e.preventDefault();
    setupModal();
    document.getElementById('signin-modal').classList.add('active');
  };

  window.closeModal = () => {
    const modal = document.getElementById('signin-modal');
    if (modal) modal.classList.remove('active');
  };

  // Close on overlay click
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      window.closeModal();
    }
  });

  // Update all runtime links to open modal
  const runtimeLinks = document.querySelectorAll('a[href="runtime.html"]');
  runtimeLinks.forEach(link => {
    // Only intercept if we are not already on the runtime page (meaning it's an external entry)
    if (!window.location.href.includes('runtime.html')) {
      link.addEventListener('click', window.openModal);
      link.removeAttribute('target'); // Prevent opening new tab if modal opens
    }
  });
});
