/* Polish (Nov 26): mark the page once it has scrolled, so the header's hairline can fade in. */
(function(){var r=document.documentElement,f=function(){r.classList.toggle("scrolled",scrollY>8)};f();addEventListener("scroll",f,{passive:true});})();
