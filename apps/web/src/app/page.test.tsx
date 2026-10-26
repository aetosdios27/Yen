import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Home from "./page";

it("renders the placeholder home page", () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html).toContain("<h1>Yen</h1>");
  expect(html).toContain("Pre-MVP. Work in progress.");
});
