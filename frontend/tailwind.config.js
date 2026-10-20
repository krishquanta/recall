/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#4F46E5', // indigo-600
        success: '#16A34A', // green-600
        warning: '#D97706', // amber-600
        error: '#DC2626',   // red-600
        surface: '#F9FAFB', // gray-50
        border: '#E5E7EB',  // gray-200
        'ocr-badge': '#7C3AED', // violet-700
      },
    },
  },
  plugins: [],
}
