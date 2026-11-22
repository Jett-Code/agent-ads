import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrandProvider } from "./halaska-kit";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <BrandProvider color="#e4572e" type="clean" radius="round">
      <App />
    </BrandProvider>
  </StrictMode>,
);
