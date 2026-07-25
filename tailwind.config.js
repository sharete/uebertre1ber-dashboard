/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.template.html",
    "./index.html",
    "./src/renderer.js"
  ],
  theme: {
    extend: {
      colors: {
        faceit: "#ff5c1a",
        "neon-blue": "#ff7a45"
      }
    }
  },
  plugins: []
};
