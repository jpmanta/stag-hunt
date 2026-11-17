// Margin quotes: the ideas Stag Hunt is built on, set beside each page.
// Free people choosing for themselves, and arranging things so those choices add up.
"use strict";
(function () {
  const Q = {
    locke: ["Every man has a property in his own person.", "John Locke, 1689"],
    mill: ["Over himself, over his own body and mind, the individual is sovereign.", "John Stuart Mill, 1859"],
    smith: ["It is not from the benevolence of the butcher, the brewer, or the baker, that we expect our dinner, but from their regard to their own interest.", "Adam Smith, 1776"],
    madison: ["Ambition must be made to counteract ambition.", "James Madison, 1788"],
    angels: ["If men were angels, no government would be necessary.", "James Madison, 1788"],
    jefferson: ["Governments are instituted among Men, deriving their just powers from the consent of the governed.", "Thomas Jefferson, 1776"],
    hang: ["We must, indeed, all hang together, or most assuredly we shall all hang separately.", "Benjamin Franklin, 1776, as told"],
    welldone: ["Well done is better than well said.", "Benjamin Franklin, 1737"],
    washington: ["Liberty, when it begins to take root, is a plant of rapid growth.", "George Washington, 1788"],
    tocqueville: ["Americans of all ages, all conditions, and all dispositions, constantly form associations.", "Alexis de Tocqueville, 1835"],
    paine: ["We have it in our power to begin the world over again.", "Thomas Paine, 1776"],
    adams: ["Facts are stubborn things.", "John Adams, 1770"],
  };
  const PAGES = {
    "/learn/the-game/": ["locke", "mill"],
    "/learn/the-proof/": ["hang", "washington"],
    "/learn/why-groups-settle/": ["smith", "madison"],
    "/learn/the-group/": ["tocqueville", "jefferson"],
    "/apply/": ["paine", "welldone"],
    "/pitch/": ["paine", "welldone"],
    "/contact/": ["tocqueville"],
    "/track/": ["adams", "welldone"],
    "/terms/": ["angels", "jefferson"],
    "/privacy/": ["locke"],
  };
  const path = location.pathname.replace(/index\.html$/, "").replace(/([^/])$/, "$1/");
  const keys = PAGES[path], main = document.querySelector("main");
  if (!keys || !main) return;
  const aside = document.createElement("aside");
  aside.className = "marg";
  aside.setAttribute("aria-label", "First principles");
  const inner = document.createElement("div");
  inner.className = "in";
  const kicker = document.createElement("div");
  kicker.className = "mk";
  kicker.textContent = "First principles";
  inner.append(kicker);
  keys.forEach((k) => {
    const [text, who] = Q[k];
    const fig = document.createElement("figure");
    const q = document.createElement("div"); q.className = "q"; q.textContent = text;
    const c = document.createElement("figcaption"); c.textContent = who;
    fig.append(q, c);
    inner.append(fig);
  });
  const belief = document.createElement("div");
  belief.className = "belief";
  belief.textContent = "Our belief: ethical capitalism. Wealth should come from building things people need, and anyone should be able to share in it.";
  inner.append(belief);
  aside.append(inner);
  main.append(aside);
})();
