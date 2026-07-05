// Portfolio Thomas Bensmaine — script.js
// Fade-in progressif des sections au scroll + ombre du header fixe.

(function () {
  "use strict";

  // --- Fade-in des sections via Intersection Observer ---
  var sections = document.querySelectorAll(".fade-section");

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -40px 0px"
      }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  } else {
    // Navigateurs sans IntersectionObserver : tout afficher directement.
    sections.forEach(function (section) {
      section.classList.add("is-visible");
    });
  }

  // --- Ombre fine du header au scroll ---
  var header = document.getElementById("site-header");

  function updateHeaderShadow() {
    if (window.scrollY > 8) {
      header.classList.add("is-scrolled");
    } else {
      header.classList.remove("is-scrolled");
    }
  }

  window.addEventListener("scroll", updateHeaderShadow, { passive: true });
  updateHeaderShadow();
})();
