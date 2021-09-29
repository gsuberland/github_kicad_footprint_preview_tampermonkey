// ==UserScript==
// @name         KiCad Footprint Preview
// @namespace    https://github.com/gsuberland/
// @homepage     https://github.com/gsuberland/github_kicad_footprint_preview_tampermonkey
// @version      0.4.1
// @description  Shows previews for KiCad footprints on GitHub.
// @author       Graham Sutherland
// @match        https://github.com/*kicad_mod*
// @icon         https://www.google.com/s2/favicons?domain=github.com
// @grant        none
// ==/UserScript==


var kicad_preview_canvas_observer = null;

class KiCadDrawingSettings
{
    static get LayerColours()
    {
        return {
            Back: {
                Default: "darkgrey",
                Copper: "blue",
                Courtyard: "gray",
                Silkscreen: "brown",
                Fabrication: "darkgreen",
                Mask: "indigo",
                Paste: "#FFFFFF33"
            },
            Inner: {
                Default: "gray",
                Copper: "magenta",
                Courtyard: "none",
                Silkscreen: "none",
                Fabrication: "none",
            },
            Front: {
                Default: "white",
                Copper: "red",
                Courtyard: "lightgray",
                Silkscreen: "gold",
                Fabrication: "green",
                Mask: "purple",
                Paste: "#FFFFFF55"
            }
        };
    }

    static get DrillColour()
    {
        return "grey";
    }

    static get LayerSideDrawOrder()
    {
        return [
            "Back",
            "Inner",
            "Front"
        ];
    }

    static get LayerTypeDrawOrder()
    {
        return [
            "Default",
            "Mask",
            "Copper",
            "Silkscreen",
            "Paste",
            "Fabrication",
            "Courtyard",
        ];
    }
}

class KiCadCanvasHelper
{
    static roundedRect(ctx, x, y, w, h, r)
    {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.moveTo(x+r, y);
        ctx.arcTo(x+w, y,   x+w, y+h, r);
        ctx.arcTo(x+w, y+h, x,   y+h, r);
        ctx.arcTo(x,   y+h, x,   y,   r);
        ctx.arcTo(x,   y,   x+w, y,   r);
        ctx.closePath();
    }
}

class KiCadModule
{
    elements = [];
}

class KiCadLayer
{
    side = "Front";
    type = "Default";

    constructor(s, t)
    {
        this.side = s;
        this.type = t;
    }

    getColour()
    {
        return KiCadDrawingSettings.LayerColours[this.side][this.type];
    }
}

class KiCadLayerSpec
{
    layers = []

    getLayerSide(sideName)
    {
        switch (sideName)
        {
            case "F":
                return "Front";
            case "I":
                return "Inner";
            case "B":
                return "Back";
            case "*":
                return "*";
            default:
                return "Front";
        }
    }

    getLayerType(typeName)
    {
        switch (typeName)
        {
            case "Cu":
                return "Copper";
            case "CrtYd":
                return "Courtyard";
            case "SilkS":
                return "Silkscreen";
            case "Fab":
                return "Fabrication";
            case "Mask":
                return "Mask";
            case "Paste":
                return "Paste";
            default:
                console.log("Unrecognised layer name: " + typeName);
                return "Default";
        }
    }

    constructor(layerObj)
    {
        if (layerObj === null)
        {
            this.layers = [new KiCadLayer("Front", "Default")];
            return;
        }

        for (var layerName of layerObj.fields)
        {
            let layerParts = layerName.split('.');
            if (layerParts.length < 2)
            {
                console.log("Invalid layer specification: " + layerName);
                this.layers.push(new KiCadLayer("Front", "Default"));
                return;
            }
            let layerSide = this.getLayerSide(layerParts[0]);
            let layerType = this.getLayerType(layerParts[1]);
            if (layerSide == "*")
            {
                for (const ls of KiCadDrawingSettings.LayerSideDrawOrder)
                {
                    this.layers.push(new KiCadLayer(ls, layerType));
                }
            }
            else
            {
                this.layers.push(new KiCadLayer(layerSide, layerType));
            }
        }
    }
}

class KiCadElement
{
    layerSpec = [];

    findChild(obj, name, warn)
    {
        let child = null;
        if (Array.isArray(name))
        {
            child = obj.children.find(c => name.includes(c.type));
        }
        else if (typeof(name) === "string")
        {
            child = obj.children.find(c => c.type == name);
        }
        else
        {
            console.log("KiCadElement.findChild called with name argument that was neither string nor array.");
        }
        if (warn && (child === null))
        {
            console.log("Warning: KiCad line missing '" + name + "' child.");
        }
        return child;
    }

    getExtents()
    {
        console.log("KiCadElement.getExtents was not overridden in the child class.");
        return null;
    }

    rescale(scale)
    {
        console.log("KiCadElement.rescale was not overridden in the child class.");
    }

    draw(canvas, ctx, layerSide, layerType)
    {
        console.log("KiCadElement.draw was not overridden in the child class.");
    }
}

/* LINE */

class KiCadLine extends KiCadElement
{
    from_x;
    from_y;
    to_x;
    to_y;
    width;

    constructor(obj)
    {
        super();
        if (obj === null)
        {
            console.log("Error: attempted to construct KiCadLine from null.");
            return;
        }
        if (obj.type !== "fp_line")
        {
            console.log("Error: attempted to construct KiCadLine from invalid input type.");
            return;
        }

        let startObj = this.findChild(obj, "start", true);
        let endObj = this.findChild(obj, "end", true);
        let widthObj = this.findChild(obj, "width", true);
        let layerObj = this.findChild(obj, ["layer", "layers"], false);

        if ((startObj?.fields?.length ?? 0) < 2)
        {
            console.log("fp_line has insufficient values in 'start' specifier.");
            return;
        }
        if ((endObj?.fields?.length ?? 0) < 2)
        {
            console.log("fp_line has insufficient values in 'end' specifier.");
            return;
        }
        if ((widthObj?.fields?.length ?? 0) < 1)
        {
            console.log("fp_line has insufficient values in 'width' specifier.");
            return;
        }

        this.from_x = parseFloat(startObj?.fields[0] ?? "NaN");
        this.from_y = parseFloat(startObj?.fields[1] ?? "NaN");
        this.to_x = parseFloat(endObj?.fields[0] ?? "NaN");
        this.to_y = parseFloat(endObj?.fields[1] ?? "NaN");
        this.width = parseFloat(widthObj?.fields[0] ?? "NaN");
        this.layerSpec = new KiCadLayerSpec(layerObj);
    }

    getExtents()
    {
        return {
            min_x: Math.min(this.from_x, this.to_x),
            max_x: Math.max(this.from_x, this.to_x),
            min_y: Math.min(this.from_y, this.to_y),
            max_y: Math.max(this.from_y, this.to_y),
        };
    }

    rescale(scale)
    {
        this.from_x *= scale;
        this.from_y *= scale;
        this.to_x *= scale;
        this.to_y *= scale;
        this.width *= scale;
    }

    draw(canvax, ctx, layerSide, layerType)
    {
        var currentLayer = this.layerSpec.layers.find(layer => (layer.side == layerSide) && (layer.type == layerType));
        if (currentLayer)
        {
            ctx.beginPath();
            ctx.moveTo(this.from_x, this.from_y);
            ctx.lineTo(this.to_x, this.to_y);
            ctx.lineWidth = this.width;
            ctx.strokeStyle = currentLayer.getColour();
            ctx.stroke();
        }
    }
}

/* ARC */

class KiCadArc extends KiCadElement
{
    from_x;
    from_y;
    to_x;
    to_y;
    angle;
    width;

    constructor(obj)
    {
        super();
        if (obj === null)
        {
            console.log("Error: attempted to construct KiCadArc from null.");
            return;
        }
        if (obj.type !== "fp_arc")
        {
            console.log("Error: attempted to construct KiCadArc from invalid input type.");
            return;
        }

        let startObj = this.findChild(obj, "start", true);
        let endObj = this.findChild(obj, "end", true);
        let angleObj = this.findChild(obj, "angle", true);
        let widthObj = this.findChild(obj, "width", true);
        let layerObj = this.findChild(obj, ["layer", "layers"], false);

        if ((startObj?.fields?.length ?? 0) < 2)
        {
            console.log("fp_arc has insufficient values in 'start' specifier.");
            return;
        }
        if ((endObj?.fields?.length ?? 0) < 2)
        {
            console.log("fp_arc has insufficient values in 'end' specifier.");
            return;
        }
        if ((angleObj?.fields?.length ?? 0) < 1)
        {
            console.log("fp_arc has insufficient values in 'angle' specifier.");
            return;
        }
        if ((widthObj?.fields?.length ?? 0) < 1)
        {
            console.log("fp_arc has insufficient values in 'width' specifier.");
            return;
        }

        this.from_x = parseFloat(startObj?.fields[0] ?? "NaN");
        this.from_y = parseFloat(startObj?.fields[1] ?? "NaN");
        this.to_x = parseFloat(endObj?.fields[0] ?? "NaN");
        this.to_y = parseFloat(endObj?.fields[1] ?? "NaN");
        this.angle = parseFloat(angleObj?.fields[0] ?? "NaN");
        this.width = parseFloat(widthObj?.fields[0] ?? "NaN");
        this.layerSpec = new KiCadLayerSpec(layerObj);
    }

    getExtents()
    {
        // todo: figure out actual extents rather than just assuming a 360 circle from the midpoint
        let radius = Math.sqrt(Math.pow(this.from_x - this.to_x, 2) + Math.pow(this.from_y - this.to_y, 2));
        const midpoint_x = (this.from_x + this.to_x) / 2;
        const midpoint_y = (this.from_y + this.to_y) / 2;
        return {
            min_x: Math.min(Math.min(this.from_x, this.to_x), midpoint_x - radius),
            max_x: Math.max(Math.max(this.from_x, this.to_x), midpoint_x + radius),
            min_y: Math.min(Math.min(this.from_y, this.to_y), midpoint_y - radius),
            max_y: Math.max(Math.max(this.from_y, this.to_y), midpoint_y + radius),
        };
    }

    rescale(scale)
    {
        this.from_x *= scale;
        this.from_y *= scale;
        this.to_x *= scale;
        this.to_y *= scale;
        this.width *= scale;
    }

    draw(canvax, ctx, layerSide, layerType)
    {
        var currentLayer = this.layerSpec.layers.find(layer => (layer.side == layerSide) && (layer.type == layerType));
        if (currentLayer)
        {
            const dx = this.from_x - this.to_x;
            const dy = this.from_y - this.to_y;
            const theta = Math.atan2(dy, dx);
            const angle = this.angle / (180/Math.PI);
            const radius = Math.sqrt(Math.pow(this.from_x - this.to_x, 2) + Math.pow(this.from_y - this.to_y, 2));
            ctx.beginPath();
            if (this.angle < 0)
            {
                ctx.arc(this.from_x, this.from_y, radius, (Math.PI) + theta, (Math.PI) + theta + angle, true);
            }
            else
            {
                ctx.arc(this.from_x, this.from_y, radius, (Math.PI) + theta, (Math.PI) + theta + angle, false);
            }
            ctx.lineWidth = this.width;
            ctx.strokeStyle = currentLayer.getColour();
            ctx.stroke
        }
    }
}

/* PAD */

class KiCadPad extends KiCadElement
{
    type;
    shape;
    pos_x;
    pos_y;
    rotation;
    size_x;
    size_y;
    drill;
    rounding = 0;

    constructor(obj)
    {
        super();
        if (obj === null)
        {
            console.log("Error: attempted to construct KiCadPad from null.");
            return;
        }
        if (obj.type !== "pad")
        {
            console.log("Error: attempted to construct KiCadPad from invalid input type.");
            return;
        }
        if (obj.fields.length < 3)
        {
            console.log("Error: attempted to construct KiCadPad from an object with insufficient fields.");
            return;
        }

        let posObj = this.findChild(obj, "at", true);
        let sizeObj = this.findChild(obj, "size", true);
        let drillObj = this.findChild(obj, "drill", true);
        let layerObj = this.findChild(obj, ["layer", "layers"], false);
        let roundrectRatioObj = this.findChild(obj, "roundrect_rratio", false);

        if ((posObj?.fields?.length ?? 0) < 2)
        {
            console.log("pad has insufficient values in 'at' specifier.");
            return;
        }
        if ((sizeObj?.fields?.length ?? 0) < 2)
        {
            console.log("pad has insufficient values in 'size' specifier.");
            return;
        }

        this.type = obj.fields[1];
        this.shape = obj.fields[2];

        if (this.type != "smd")
        {
            if ((drillObj?.fields?.length ?? 0) < 1)
            {
                console.log("pad has insufficient values in 'drill' specifier.");
                return;
            }
        }

        if (roundrectRatioObj)
        {
            this.rounding = parseFloat(roundrectRatioObj?.fields[0] ?? "0");
        }

        this.pos_x = parseFloat(posObj?.fields[0] ?? "NaN");
        this.pos_y = parseFloat(posObj?.fields[1] ?? "NaN");
        this.rotation = parseFloat(posObj?.fields[2] ?? "NaN");
        this.size_x = parseFloat(sizeObj?.fields[0] ?? "NaN");
        this.size_y = parseFloat(sizeObj?.fields[1] ?? "NaN");
        if (this.type != "smd")
        {
            this.drill = parseFloat(drillObj?.fields[0] ?? "NaN");
        }
        this.layerSpec = new KiCadLayerSpec(layerObj);
    }

    getExtents()
    {
        return {
            min_x: this.pos_x - (Math.max(this.size_x, this.drill) / 2),
            max_x: this.pos_x + (Math.max(this.size_x, this.drill) / 2),
            min_y: this.pos_y - (Math.max(this.size_y, this.drill) / 2),
            max_y: this.pos_y + (Math.max(this.size_y, this.drill) / 2),
        };
    }

    rescale(scale)
    {
        this.pos_x *= scale;
        this.pos_y *= scale;
        this.size_x *= scale;
        this.size_y *= scale;
        this.drill *= scale;
    }

    draw(canvax, ctx, layerSide, layerType)
    {
        var currentLayer = this.layerSpec.layers.find(layer => (layer.side == layerSide) && (layer.type == layerType));
        if (currentLayer)
        {
            if (this.type != "np_thru_hole")
            {
                switch (this.shape)
                {
                    case "circle":
                        {
                            ctx.beginPath();
                            ctx.ellipse(this.pos_x, this.pos_y, this.size_x / 2, this.size_y / 2, 0, 0, Math.PI*2);
                            ctx.fillStyle = currentLayer.getColour();
                            ctx.fill();
                            break;
                        }
                    case "rect":
                        {
                            ctx.beginPath();
                            // hack: support 90 degree rotation steps by just swapping size x/y
                            let rsize_x = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_y : this.size_x;
                            let rsize_y = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_x : this.size_y;
                            ctx.rect(this.pos_x - (rsize_x / 2), this.pos_y - (rsize_y / 2), rsize_x, rsize_y);
                            ctx.fillStyle = currentLayer.getColour();
                            ctx.fill();
                            break;
                        }
                    case "roundrect":
                        {
                            ctx.beginPath();
                            // hack: support 90 degree rotation steps by just swapping size x/y
                            let rsize_x = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_y : this.size_x;
                            let rsize_y = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_x : this.size_y;
                            let r = this.rounding * Math.min(this.size_x, this.size_y);
                            KiCadCanvasHelper.roundedRect(ctx, this.pos_x - (rsize_x / 2), this.pos_y - (rsize_y / 2), rsize_x, rsize_y, r);
                            ctx.fillStyle = currentLayer.getColour();
                            ctx.fill();
                            break;
                        }
                    case "oval":
                        {
                            let radius = Math.min(this.size_x, this.size_y) / 2;
                            // hack: support 90 degree rotation steps by just swapping size x/y
                            let rsize_x = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_y : this.size_x;
                            let rsize_y = ((this.rotation == 90) || (this.rotation == 270)) ? this.size_x : this.size_y;
                            if (rsize_x == rsize_y)
                            {
                                // not elongated, just draw it as a circle
                                ctx.beginPath();
                                ctx.ellipse(this.pos_x, this.pos_y, rsize_x / 2, rsize_y / 2, 0, 0, Math.PI*2);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                            }
                            else if (rsize_y > rsize_x)
                            {
                                // elongated vertically
                                ctx.beginPath();
                                ctx.ellipse(this.pos_x, (this.pos_y - (rsize_y / 2)) + radius, radius, radius, 0, 0, Math.PI*2);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                                ctx.beginPath();
                                ctx.ellipse(this.pos_x, (this.pos_y + (rsize_y / 2)) - radius, radius, radius, 0, 0, Math.PI*2);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                                ctx.beginPath();
                                ctx.rect(this.pos_x - (rsize_x / 2), (this.pos_y + radius) - (rsize_y / 2), rsize_x, rsize_y - (radius * 2));
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                            }
                            else
                            {
                                // elongated horizontally
                                ctx.beginPath();
                                ctx.ellipse((this.pos_x - (rsize_x / 2)) + radius, this.pos_y, radius, radius, 0, 0, Math.PI*2);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                                ctx.beginPath();
                                ctx.ellipse((this.pos_x + (rsize_x / 2)) - radius, this.pos_y, radius, radius, 0, 0, Math.PI*2);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                                ctx.beginPath();
                                ctx.rect((this.pos_x + radius) - (rsize_x / 2), this.pos_y - (rsize_y / 2), rsize_x - (radius * 2), rsize_y);
                                ctx.fillStyle = currentLayer.getColour();
                                ctx.fill();
                            }
                            break;
                        }
                }
            }
            if (this.type == "thru_hole" || this.type == "np_thru_hole")
            {
                ctx.beginPath();
                ctx.ellipse(this.pos_x, this.pos_y, this.drill / 2, this.drill / 2, 0, 0, Math.PI*2);
                ctx.lineWidth = 1;
                ctx.fillStyle = KiCadDrawingSettings.DrillColour;
                ctx.fill();
            }
        }
    }
}

function kicad_parse_syntax(code)
{
    let depth = 0;
    let rootObject = { depth: 0, contents: '', type: '', fields: [], parent: null, children: [] };
    let currentObject = rootObject;
    for (const c of code)
    {
        if (c == '(')
        {
            depth++;
            let newObject = { depth: depth, contents: '', type: '', fields: [], parent: currentObject, children: [] };
            currentObject.children.push(newObject);
            currentObject = newObject;
        }
        else if (c == ')')
        {
            depth--;
            currentObject = currentObject.parent;
        }
        else
        {
            currentObject.contents += c;
        }
    }
    // post-process all objects
    let remainingObjects = [];
    remainingObjects.push(rootObject);
    while (remainingObjects.length > 0)
    {
        currentObject = remainingObjects.shift();
        remainingObjects = remainingObjects.concat(currentObject.children);
        currentObject.contents = currentObject.contents.trim();
        let fields = currentObject.contents.split(' ');
        if (fields.length > 0)
        {
            currentObject.type = fields.shift();
        }
        currentObject.fields = fields;
    }
    // return the main module object
    if (rootObject.children.length == 0)
    {
        console.log("Couldn't parse KiCad syntax.");
        return null;
    }
    if (rootObject.children.length > 1)
    {
        console.log("Warning: more than one root object found. Only returning the first.");
    }
    //console.log(rootObject.children[0]);
    return rootObject.children[0];
}

function kicad_syntax_to_model(moduleObject)
{
    let module = new KiCadModule();
    for (const childObject of moduleObject.children)
    {
        switch (childObject.type)
        {
            case "fp_line":
                module.elements.push(new KiCadLine(childObject));
                break;
            case "fp_arc":
                module.elements.push(new KiCadArc(childObject));
                break;
            case "pad":
                module.elements.push(new KiCadPad(childObject));
                break;
        }
    }
    //console.log(module);
    return module;
}

function kicad_preview_canvas_handler(event) {
    // check if the preview already exists
    if (document.getElementById('kicad_preview_canvas') !== null)
    {
        console.log('Not executing handler because kicad_preview_canvas already exists.');
        return;
    }

    // first find the header box above the code
    const contribBox = document.getElementById("blob_contributors_box");
    if (contribBox === null)
    {
        console.log('Failed to find blob_contributors_box element to inject canvas preview after.');
        return;
    }
    let headerBox = contribBox;
    do
    {
        headerBox = headerBox.parentElement;
        if (headerBox == null)
        {
            console.log('Failed to find header box element as a parent of the contributors box.');
            return;
        }
    }
    while (!headerBox.classList.contains("Box"));
    // inject preview box & canvas
    headerBox.insertAdjacentHTML('afterend', '<div id="kicad_preview_container" class="Box d-flex flex-column flex-shrink-0 mb-3"><div class="Box-header Details js-details-container"><span>Preview</span></div><canvas id="kicad_preview_canvas"></canvas></div>');

    // fetch plaintext
    var rawUrl = document.getElementById('raw-url');
    fetch(rawUrl, {
        "method": "GET"
    }).then(
        function(response) {
            if (response.status !== 200)
            {
                console.log('Failed to get raw code for footprint. Status: ' + response.status);
                return;
            }

            // grab the data from the response
            response.text().then(function(code) {

                if (document.getElementById('kicad_preview_container') === null)
                {
                    console.log('Error: Failed to find the container.');
                    return;
                }

                const canvas = document.getElementById('kicad_preview_canvas');
                if (canvas === null)
                {
                    console.log('Error: Failed to find the canvas.');
                    return;
                }

                const ctx = canvas.getContext('2d');

                let dpi = window.devicePixelRatio;
                let style_height = +getComputedStyle(canvas).getPropertyValue("height").slice(0, -2);
                let style_width = +getComputedStyle(canvas).getPropertyValue("width").slice(0, -2);
                canvas.setAttribute('height', style_height * dpi);
                canvas.setAttribute('width', style_width * dpi);

                ctx.imageSmoothingEnabled = false;

                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = 'white';


                let moduleObject = kicad_parse_syntax(code);
                let model = kicad_syntax_to_model(moduleObject);

                let min_x = Number.MAX_SAFE_INTEGER;
                let max_x = Number.MIN_SAFE_INTEGER;
                let min_y = Number.MAX_SAFE_INTEGER;
                let max_y = Number.MIN_SAFE_INTEGER;

                for (const modelElement of model.elements)
                {
                    let extents = modelElement.getExtents();
                    if (!isNaN(extents.min_x))
                        min_x = Math.min(min_x, extents.min_x);
                    if (!isNaN(extents.min_y))
                        min_y = Math.min(min_y, extents.min_y);
                    if (!isNaN(extents.max_x))
                        max_x = Math.max(max_x, extents.max_x);
                    if (!isNaN(extents.max_y))
                        max_y = Math.max(max_y, extents.max_y);
                }

                let delta_x = Math.max(0.00001, max_x - min_x);
                let delta_y = Math.max(0.00001, max_y - min_y);
                let scale = Math.min(canvas.width / delta_x, canvas.height / delta_y);

                scale *= 0.9;

                for (const modelElement of model.elements)
                {
                    modelElement.rescale(scale);
                }

                min_x = Number.MAX_SAFE_INTEGER;
                max_x = Number.MIN_SAFE_INTEGER;
                min_y = Number.MAX_SAFE_INTEGER;
                max_y = Number.MIN_SAFE_INTEGER;

                for (const modelElement of model.elements)
                {
                    let extents = modelElement.getExtents();
                    if (!isNaN(extents.min_x))
                        min_x = Math.min(min_x, extents.min_x);
                    if (!isNaN(extents.min_y))
                        min_y = Math.min(min_y, extents.min_y);
                    if (!isNaN(extents.max_x))
                        max_x = Math.max(max_x, extents.max_x);
                    if (!isNaN(extents.max_y))
                        max_y = Math.max(max_y, extents.max_y);
                }

                delta_x = max_x - min_x;
                delta_y = max_y - min_y;

                // center the drawing
                ctx.translate(-min_x, -min_y);
                ctx.translate(-delta_x / 2, -delta_y / 2);
                ctx.translate(canvas.width/2, canvas.height/2);

                // draw grid
                ctx.lineWidth = 0.01 * scale;
                ctx.strokeStyle = "white";
                ctx.globalAlpha = 0.25;
                for (let x = max_x + canvas.width; x > min_x - canvas.width; x -= scale)
                {
                    ctx.beginPath();
                    ctx.moveTo(x, -canvas.height);
                    ctx.lineTo(x, canvas.height);
                    ctx.stroke();
                }
                for (let y = max_y + canvas.height; y > min_y - canvas.height; y -= scale)
                {
                    ctx.beginPath();
                    ctx.moveTo(-canvas.width, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }
                ctx.globalAlpha = 0.85;

                for (const layerSide of KiCadDrawingSettings.LayerSideDrawOrder)
                {
                    for (const layerType of KiCadDrawingSettings.LayerTypeDrawOrder)
                    {
                        for (const modelElement of model.elements)
                        {
                            modelElement.draw(canvas, ctx, layerSide, layerType);
                        }
                    }
                }
            });
        }
    ).catch(function(err) {
        console.log('Failed to fetch ' + rawUrl, err);
    });
};

(function() {
    'use strict';

    window.addEventListener('load', kicad_preview_canvas_handler);

    kicad_preview_canvas_observer = new MutationObserver(mutationRecords => {
        /*for (var mutation of mutationRecords)
        {
            console.log(mutation);
        }*/
        kicad_preview_canvas_handler(mutationRecords);
    });

    kicad_preview_canvas_observer.observe(document, {childList: true, subtree: true});
})();