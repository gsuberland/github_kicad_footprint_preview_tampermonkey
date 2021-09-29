// ==UserScript==
// @name         KiCad Footprint Preview
// @namespace    https://github.com/gsuberland/
// @homepage     https://github.com/gsuberland/github_kicad_footprint_preview_tampermonkey
// @version      0.3.2
// @description  Shows previews for KiCad footprints on GitHub.
// @author       Graham Sutherland
// @match        https://github.com/*kicad_mod*
// @icon         https://www.google.com/s2/favicons?domain=github.com
// @grant        none
// ==/UserScript==

var kicad_preview_canvas_observer = null;

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
                const fp_line_re = /\(fp_line\s+\(start\s+(?<from_x>-?\d+(?:\.\d+)?)\s+(?<from_y>-?\d+(?:\.\d+)?)\)\s+\(end\s+(?<to_x>-?\d+(?:\.\d+)?)\s+(?<to_y>-?\d+(?:\.\d+)?)\).*\(width\s(?<width>-?\d+(?:\.\d+)?)\)/g;
                const fp_pad_circle_re = /\(pad.*\s+(?:np_thru_hole|thru_hole|smd)\s+(?:circle|oval)\s+\(at\s+(?<pos_x>-?\d+(?:\.\d+)?)\s+(?<pos_y>-?\d+(?:\.\d+)?)\)\s+\(size\s+(?<size_x>-?\d+(?:\.\d+)?)\s+(?<size_y>-?\d+(?:\.\d+)?)\)(?:\s+\(drill\s+(?<drill>-?\d+(?:\.\d+)?)\))?/g;
                const fp_pad_rect_re = /\(pad.*\s+(?:round)?rect\s+\(at\s+(?<pos_x>-?\d+(?:\.\d+)?)\s+(?<pos_y>-?\d+(?:\.\d+)?)\)\s+\(size\s+(?<size_x>-?\d+(?:\.\d+)?)\s+(?<size_y>-?\d+(?:\.\d+)?)\)(?:\s+\(drill\s+(?<drill>-?\d+(?:\.\d+)?)\))?/g;

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

                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = 'black';

                // we need to keep track of min and max x/y coords so we can scale the preview
                let min_x = Number.MAX_SAFE_INTEGER;
                let max_x = Number.MIN_SAFE_INTEGER;
                let min_y = Number.MAX_SAFE_INTEGER;
                let max_y = Number.MIN_SAFE_INTEGER;

                // process lines
                const lineMatches = code.matchAll(fp_line_re);
                let lines = [];
                for (const match of lineMatches)
                {
                    let line = {
                        from_x: parseFloat(match.groups.from_x),
                        from_y: parseFloat(match.groups.from_y),
                        to_x: parseFloat(match.groups.to_x),
                        to_y: parseFloat(match.groups.to_y),
                        width: parseFloat(match.groups.width)
                    };
                    min_x = Math.min(min_x, line.from_x);
                    min_x = Math.min(min_x, line.to_x);
                    min_y = Math.min(min_y, line.from_y);
                    min_y = Math.min(min_y, line.to_y);
                    max_x = Math.max(max_x, line.from_x);
                    max_x = Math.max(max_x, line.to_x);
                    max_y = Math.max(max_y, line.from_y);
                    max_y = Math.max(max_y, line.to_y);
                    lines.push(line);
                }

                // process circle pads
                const circlePadMatches = code.matchAll(fp_pad_circle_re);
                let circles = [];
                for (const match of circlePadMatches)
                {
                    let circle = {
                        pos_x: parseFloat(match.groups.pos_x),
                        pos_y: parseFloat(match.groups.pos_y),
                        size_x: parseFloat(match.groups.size_x),
                        size_y: parseFloat(match.groups.size_y),
                        drill: parseFloat(match.groups.drill ?? "0")
                    };
                    min_x = Math.min(min_x, circle.pos_x - Math.max(circle.size_x, circle.drill));
                    min_y = Math.min(min_y, circle.pos_y - Math.max(circle.size_y, circle.drill));
                    max_x = Math.max(max_x, circle.pos_x + Math.max(circle.size_x, circle.drill));
                    max_y = Math.max(max_y, circle.pos_y + Math.max(circle.size_y, circle.drill));
                    circles.push(circle);
                }

                // process rectangle pads
                const rectPadMatches = code.matchAll(fp_pad_rect_re);
                let rects = [];
                for (const match of rectPadMatches)
                {
                    let rect = {
                        pos_x: parseFloat(match.groups.pos_x),
                        pos_y: parseFloat(match.groups.pos_y),
                        size_x: parseFloat(match.groups.size_x),
                        size_y: parseFloat(match.groups.size_y),
                        drill: parseFloat(match.groups.drill ?? "0")
                    };
                    min_x = Math.min(min_x, rect.pos_x);
                    min_y = Math.min(min_y, rect.pos_y);
                    max_x = Math.max(max_x, rect.pos_x + rect.size_x);
                    max_y = Math.max(max_y, rect.pos_y + rect.size_y);
                    rects.push(rect);
                }

                // scale everything and re-compute min & max
                let delta_x = Math.max(0.00001, max_x - min_x);
                let delta_y = Math.max(0.00001, max_y - min_y);
                let scale = Math.min(canvas.width / delta_x, canvas.height / delta_y);
                //console.log("width = " + canvas.width + ", height = " + canvas.height);
                //console.log("min_x = " + min_x + ", max_x = " + max_x + ", min_y = " + min_y + ", max_y = " + max_y + ", delta_x = " + delta_x + ", delta_y = " + delta_y + ", scale = " + scale);

                scale *= 0.9;

                min_x = Number.MAX_SAFE_INTEGER;
                max_x = Number.MIN_SAFE_INTEGER;
                min_y = Number.MAX_SAFE_INTEGER;
                max_y = Number.MIN_SAFE_INTEGER;
                for (var line of lines)
                {
                    line.from_x *= scale;
                    line.from_y *= scale;
                    line.to_x *= scale;
                    line.to_y *= scale;
                    line.width *= scale;
                    min_x = Math.min(min_x, line.from_x);
                    min_x = Math.min(min_x, line.to_x);
                    min_y = Math.min(min_y, line.from_y);
                    min_y = Math.min(min_y, line.to_y);
                    max_x = Math.max(max_x, line.from_x);
                    max_x = Math.max(max_x, line.to_x);
                    max_y = Math.max(max_y, line.from_y);
                    max_y = Math.max(max_y, line.to_y);
                }
                for (var circle of circles)
                {
                    circle.pos_x *= scale;
                    circle.pos_y *= scale;
                    circle.size_x *= scale;
                    circle.size_y *= scale;
                    circle.drill *= scale;
                    min_x = Math.min(min_x, circle.pos_x - Math.max(circle.size_x, circle.drill));
                    min_y = Math.min(min_y, circle.pos_y - Math.max(circle.size_y, circle.drill));
                    max_x = Math.max(max_x, circle.pos_x + Math.max(circle.size_x, circle.drill));
                    max_y = Math.max(max_y, circle.pos_y + Math.max(circle.size_y, circle.drill));
                }
                for (var rect of rects)
                {
                    rect.pos_x *= scale;
                    rect.pos_y *= scale;
                    rect.size_x *= scale;
                    rect.size_y *= scale;
                    rect.drill *= scale;
                    min_x = Math.min(min_x, rect.pos_x);
                    min_y = Math.min(min_y, rect.pos_y);
                    max_x = Math.max(max_x, rect.pos_x + rect.size_x);
                    max_y = Math.max(max_y, rect.pos_y + rect.size_y);
                }
                delta_x = max_x - min_x;
                delta_y = max_y - min_y;
                //console.log("min_x = " + min_x + ", max_x = " + max_x + ", min_y = " + min_y + ", max_y = " + max_y + ", delta_x = " + delta_x + ", delta_y = " + delta_y + ", scale = " + scale);

                // center the drawing
                ctx.translate(-min_x, -min_y);
                ctx.translate(-delta_x / 2, -delta_y / 2);
                ctx.translate(canvas.width/2, canvas.height/2);

                // draw lines
                for (const line of lines)
                {
                    //console.log(line);
                    ctx.beginPath();
                    ctx.moveTo(line.from_x, line.from_y);
                    ctx.lineTo(line.to_x, line.to_y);
                    ctx.lineWidth = line.width;
                    ctx.stroke();
                }
                // draw circles
                for (const circle of circles)
                {
                    //console.log(circle);
                    ctx.beginPath();
                    ctx.ellipse(circle.pos_x, circle.pos_y, circle.size_x / 2, circle.size_y / 2, 0, 0, Math.PI*2);
                    ctx.lineWidth = 1;
                    ctx.fillStyle = 'red';
                    ctx.fill();
                    ctx.stroke();
                    if (circle.drill > 0.00001)
                    {
                        ctx.beginPath();
                        ctx.ellipse(circle.pos_x, circle.pos_y, circle.drill / 2, circle.drill / 2, 0, 0, Math.PI*2);
                        ctx.lineWidth = 1;
                        ctx.fillStyle = 'grey';
                        ctx.fill();
                        ctx.stroke();
                    }
                }
                // draw rectangles
                for (const rect of rects)
                {
                    console.log(rect);
                    ctx.beginPath();
                    ctx.rect(rect.pos_x - (rect.size_x / 2), rect.pos_y - (rect.size_y / 2), rect.size_x, rect.size_y);
                    ctx.lineWidth = 1;
                    ctx.fillStyle = 'red';
                    ctx.fill();
                    ctx.stroke();
                    if (rect.drill > 0.00001)
                    {
                        ctx.beginPath();
                        ctx.ellipse(rect.pos_x, rect.pos_y, rect.drill / 2, rect.drill / 2, 0, 0, Math.PI*2);
                        ctx.lineWidth = 1;
                        ctx.fillStyle = 'grey';
                        ctx.fill();
                        ctx.stroke();
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

    //document.kicad_footprint_preview.handler(null);

    kicad_preview_canvas_observer = new MutationObserver(mutationRecords => {
        for (var mutation of mutationRecords)
        {
            console.log(mutation);
        }
        kicad_preview_canvas_handler(mutationRecords);
    });

    kicad_preview_canvas_observer.observe(document, {childList: true, subtree: true});
})();