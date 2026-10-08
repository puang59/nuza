import { describe, expect, test } from "bun:test";
import { MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH, readAltSize, withImageWidth } from "../src/lib/markdown/imageSize";
import { readEmbed } from "../src/lib/markdown/wikiLinks";

describe("readAltSize", () => {
  test("takes a width off the end of the alt text", () => {
    expect(readAltSize("a dog|300")).toEqual({ alt: "a dog", width: 300 });
    expect(readAltSize("a dog | 300 ")).toEqual({ alt: "a dog", width: 300 });
    expect(readAltSize("|120")).toEqual({ alt: "", width: 120 });
  });

  test("leaves alt text with no width, or with a bar that is not one, alone", () => {
    expect(readAltSize("a dog")).toEqual({ alt: "a dog", width: null });
    expect(readAltSize("this|that")).toEqual({ alt: "this|that", width: null });
    expect(readAltSize("a dog|0")).toEqual({ alt: "a dog", width: null });
  });
});

describe("withImageWidth", () => {
  test("writes a width into an image, replaces one, and takes one off", () => {
    expect(withImageWidth("![a dog](dog.png)", 300)).toBe("![a dog|300](dog.png)");
    expect(withImageWidth("![a dog|300](dog.png)", 180)).toBe("![a dog|180](dog.png)");
    expect(withImageWidth("![a dog|300](dog.png)", null)).toBe("![a dog](dog.png)");
    expect(withImageWidth("![](dog.png)", 200)).toBe("![|200](dog.png)");
  });

  test("keeps an alt text with brackets in it, and a title after the target", () => {
    expect(withImageWidth("![a [good] dog](dog.png)", 240)).toBe("![a [good] dog|240](dog.png)");
    expect(withImageWidth('![dog](dog.png "Rex")', 240)).toBe('![dog|240](dog.png "Rex")');
  });

  test("does the same for an embed, keeping any words it has", () => {
    expect(withImageWidth("![[dog.png]]", 300)).toBe("![[dog.png|300]]");
    expect(withImageWidth("![[dog.png|300]]", 180)).toBe("![[dog.png|180]]");
    expect(withImageWidth("![[dog.png|a dog]]", 180)).toBe("![[dog.png|a dog|180]]");
    expect(withImageWidth("![[dog.png|a dog|180]]", null)).toBe("![[dog.png|a dog]]");
  });

  test("holds the width between its limits, and whole", () => {
    expect(withImageWidth("![[dog.png]]", 3)).toBe(`![[dog.png|${MIN_IMAGE_WIDTH}]]`);
    expect(withImageWidth("![[dog.png]]", 99999)).toBe(`![[dog.png|${MAX_IMAGE_WIDTH}]]`);
    expect(withImageWidth("![[dog.png]]", 250.6)).toBe("![[dog.png|251]]");
  });

  test("leaves anything that is not an image exactly as it is", () => {
    expect(withImageWidth("[a link](page.md)", 300)).toBeNull();
    expect(withImageWidth("plain text", 300)).toBeNull();
  });
});

describe("an embed that has been resized", () => {
  test("reads back as the same file, words and width", () => {
    expect(readEmbed("dog.png|a dog|180")).toEqual({ target: "dog.png", width: 180, alt: "a dog" });
    expect(readEmbed("dog.png|180")).toEqual({ target: "dog.png", width: 180, alt: null });
    expect(readEmbed("dog.png|a dog")).toEqual({ target: "dog.png", width: null, alt: "a dog" });
    expect(readEmbed("dog.png")).toEqual({ target: "dog.png", width: null, alt: null });
  });
});
