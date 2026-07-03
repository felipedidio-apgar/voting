export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Georgia", "Cambria", "serif"],
        body: ["ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        ink: "#15110c",
        paper: "#f8f4ea",
        brass: "#b58a32",
        ember: "#c94c24",
        moss: "#4c6348"
      },
      boxShadow: {
        line: "0 1px 0 rgba(21, 17, 12, 0.14)"
      }
    }
  },
  plugins: []
};
