import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "../src/components/ErrorBoundary";

describe("ErrorBoundary", () => {
  test("draws what it was given while nothing is wrong", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>
    );
    expect(html).toBe("<p>the app</p>");
  });

  test("turns whatever was thrown into an error to show", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("storage is full")).error?.message).toBe(
      "storage is full"
    );
    expect(ErrorBoundary.getDerivedStateFromError("a bare string").error?.message).toBe("a bare string");
  });

  test("says what went wrong and offers a reload in place of a blank window", () => {
    const boundary = new ErrorBoundary({ children: <p>the app</p> });
    boundary.state = { error: new Error("storage is full") };

    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('role="alert"');
    expect(html).toContain("storage is full");
    expect(html).toContain("Reload");
    expect(html).not.toContain("the app");
  });
});
