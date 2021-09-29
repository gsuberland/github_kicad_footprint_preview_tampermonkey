# GitHub KiCad Footprint Preview Userscript

This is a userscript for Tampermonkey that shows graphical previews of KiCad footprints on GitHub.

This works for any `.kicad_mod` file you view on GitHub.

![Example image](example.jpg)

The script has been tested with Tampermonkey for Chrome. It should also work on Greasemonkey, and Chromium, but I have not tested it.

## Features

This is a low-effort script that does most of its parsing with regex. It currently supports displaying:

- Lines (`fp_line`) with the correct width
- Circular and oval TH / SMD pads
- Non-plated circular TH pads
- Rectangular pads with optional thru-holes
- Rounded rectangle pads (displayed as rectangles)

This should be sufficient to quickly identify whether a part is the one you wanted.

### Bugs / missing stuff

Stuff with limited or no support:

- Ovals are displayed as ellipses, not slots
- Arcs
- Text
- Rotation values in `at` spec - these are currently ignored when present
- Layers - all lines are shown as black, all pads are currently shown as red
- Models - this will probably never be supported

## Contributing

Issues and pull requests welcome, but keep in mind that this was just hacked together in an evening because it was an interesting challenge, so I probably won't invest too much more time in it.

## Changelog

**v0.3.3**

Patched in limited support for 3-value `at` specifications for circle and oval pads. Previously any pad with this type of `at` spec was just missing from the preview render, because the regex didn't match on them. Given that I've only seen multiples of 90 as the third value, it appears to be rotation. For circles this is obviously meaningless. Currently the rotation is ignored.

**v0.3.2**

Patched in basic support for `oval`. They are drawn as ellipses rather than slots, but that's better than just not showing up at all.

**v0.3.1**

Fixed missing support for `np_through_hole` pads.

Note: They currently render just like regular pads, but in all examples seen so far the pad size and drill size are the same, so the rendered copper area is obscured by the drill hole anyway.

**v0.3:**

Added limited `roundrect` support - displaying as plain rectangles.

**v0.2:**

Added support for circular SMD pads.

**v0.1**

Initial release.