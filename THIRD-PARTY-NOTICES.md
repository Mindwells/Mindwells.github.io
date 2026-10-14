# Third-party notices

This project's own source is covered by [`LICENSE`](./LICENSE). The built site
redistributes the font software listed below, which is why its notices are
reproduced here.

---

## Fonts

The three typefaces are self-hosted. The build emits **Latin-subset WOFF2
files** into `dist/`, so the font software is redistributed and the licence
below applies.

All three are licensed under the **SIL Open Font License, Version 1.1**, which
permits redistribution and embedding provided the copyright notice and licence
accompany the files. Full licence text:
<https://scripts.sil.org/OFL>

### Inter

```
Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
```

Packaged as `@fontsource-variable/inter`.

### Newsreader

```
Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)
```

Packaged as `@fontsource-variable/newsreader`.

### JetBrains Mono

```
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
```

Packaged as `@fontsource-variable/jetbrains-mono`.

---

## Build tooling

These run at build time and are **not** redistributed in the built site:

| Package | Licence |
| --- | --- |
| `astro` | MIT |
| `@astrojs/sitemap` | MIT |
| `@astrojs/check` | MIT |
| `typescript` | Apache-2.0 |

---

## Earlier version

The site was previously built on the `academicpages` Jekyll template. That
work is preserved on the `v1-academicpages` git tag; none of its code remains
on the current branch.
