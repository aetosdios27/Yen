import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Home from "./page";

it("renders only the product name until copy ships with i18n", () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html).toContain("<h1>Yen</h1>");
});
