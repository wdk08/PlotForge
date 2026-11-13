# PlotForge furniture library files

**Export Library** writes UTF-8 JSON. **Import Library** validates the entire file before saving any designs. A file can contain up to 500 templates and occupy up to 4 MiB. Imported templates with IDs already present in the library are added as separate copies.

```json
{
  "format": "plotforge-furniture",
  "version": 1,
  "templates": [
    {
      "id": "9d96fd00-3dfa-4ef8-a21b-590f265e96cd",
      "name": "Low bench",
      "category": "outdoor",
      "w": 120,
      "h": 42,
      "design": {
        "w": 300,
        "h": 120,
        "parts": [
          {
            "type": "rectangle",
            "x": 0,
            "y": 0,
            "w": 270,
            "h": 95,
            "angle": 0,
            "fill": "#af8b62",
            "stroke": "#473b2d",
            "weight": 2,
            "solid": true
          }
        ]
      }
    }
  ]
}
```

- Template IDs are unique UUIDs. Category keys are `bedroom`, `living`, `bathroom`, `kitchen`, `office`, `laundry`, `outdoor`, `misc`, and `my`. My Furniture displays saved templates from every category.
- Template dimensions are centimeters. Design dimensions define a centered drawing space. A part's `x` and `y` locate its center, and its `w` and `h` are measured in that space. Rotation is in degrees. Parts are drawn in array order, back to front.
- Part types are `rectangle`, `ellipse`, `line`, `polygon`, `text`, and `symbol`. Polygons include a `points` array of 3–100 normalized `[x, y]` pairs in the range −0.5 to 0.5. Text parts include a plain `text` string. Symbol parts include a built-in furniture ID in `symbol`. Colors are six-digit hexadecimal strings. `weight` is the border width, and `solid` enables the fill.
- Each design contains 1–200 parts. PlotForge draws supported primitives and treats text as text. The file format does not use SVG markup, scripts, or external resources.
- The library is saved in the local app profile. Browser profiles and the desktop app each have their own library. Use export/import to transfer templates. A placed item stores its own copy of the design in the `.plf` project.
