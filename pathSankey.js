d3.pathSankey = function() {

  /* 
  Split SVG text into several <tspan> where
  string has newline character \n

  Based on http://bl.ocks.org/mbostock/7555321
  */
  function linebreak(text) {
    text.each(function() {
      var text = d3.select(this),
          words = text.text().split(/\n/).reverse(),
          word,
          lineNumber = 0,
          lineHeight = 1.1, // ems
          y = text.attr("y"),
          x = text.attr("x"),
          dx = text.attr("dx"),
          dy = 0.3 - (words.length-1)*lineHeight*0.5; //ems
      text.text(null);
      while (word = words.pop()) {
        tspan = text.append("tspan").attr("dx",dx).attr("x", x).attr("y", y).attr("dy", lineNumber++ * lineHeight + dy + "em").text(word);
      }
    });
  }


  function prop(p) {
    return function(d) {
      return d[p];
    };
  }

  var width, height; // total width including padding
  var onNodeSelected, onNodeDeselected; // callbacks
  var labelspace = {top:50,left:30,right:30,bottom:0}; // padding around actual sankey
  var selectedNodeAddress = null;

  var nodeYSpacing = 3,
      nodeGroupYSpacing = 0;

  var nodeGroupYPadding = 10;

  var nodeWidth = 30;

  var groupLabelDistance = 5;
  var flowStartWidth = 20; // flows go horizontally for this distance before curving

  function chart(selection) {

    selection.each(function(data){

      var parent = d3.select(this);
      var yscale; // not a d3.scale, just a number
      var currentlyActive = null; // node

      var availableWidth = width - (labelspace.right+labelspace.left);
      var availableHeight = height - (labelspace.top + labelspace.bottom);

      var flowAreasData = [];


      /* 
      The following anonymous function is used to scope the algorithm for
      preparing the data.

      It computes sizes and positions for all nodes 
      and flows and saves them *on* original data structure.

      It does not mutate original data (because then multiple call() would
      destroy the chart.) 
      */ 
      (function() {

        var nodes = data.nodes;
        var flows = data.flows;

        // reset counters from any previous render
        nodes.forEach(function(layer){
          layer.size = layer.sizeIn = layer.sizeOut = 0;
          layer.items.forEach(function(group){
            group.size = group.sizeIn = group.sizeOut = 0;
            group.items.forEach(function(node){
              node.size = node.sizeIn = node.sizeOut = 0;
              node.filledOutY = 0;
              node.filledInY = 0;
            });
          });
        });

        // compute and store sizes of all layers, groups and nodes by counting flows through them
        flows.forEach(function(flow){
          flow.path.forEach(function(p,i) {
            var layer = nodes[p[0]];
            var nodeGroup = layer.items[p[1]];
            var node = nodeGroup.items[p[2]];
            if (i > 0) { 
              layer.sizeIn += flow.magnitude;
              nodeGroup.sizeIn += flow.magnitude;
              node.sizeIn += flow.magnitude;
            }
            if (i < flow.path.length-1) {
              layer.sizeOut += flow.magnitude;
              nodeGroup.sizeOut += flow.magnitude;
              node.sizeOut += flow.magnitude;
            }
          });
        });

        nodes.forEach(function(layer){
          layer.size = d3.max([layer.sizeIn, layer.sizeOut]);
          layer.items.forEach(function(group){
            group.size = d3.max([group.sizeIn, group.sizeOut]);
            group.items.forEach(function(node){
              node.size = d3.max([node.sizeIn, node.sizeOut]);
            });
          });
        });        

        
        nodes.forEach(function(layer){
          layer.numNodeSpacings = d3.sum(layer.items, function(g){return g.items.length-1;});
          layer.numGroupSpacings = layer.items.length-1;
        });

        // yscale calibrated to fill available height according to equation:
        // availableHeight == size*yscale + group_spacing + group_padding + node_spacing
        // (take worst case: smallest value)
        yscale = d3.min(nodes, function(d){
          return (availableHeight 
                  - d.numGroupSpacings*nodeGroupYSpacing
                  - d.items.length*nodeGroupYPadding*2
                  - d.numNodeSpacings*nodeYSpacing)/d.size;
        });

        // compute layer heights by summing all sizes and spacings
        nodes.forEach(function(layer){
          layer.totalHeight = layer.size * yscale
                              + layer.numGroupSpacings*nodeGroupYSpacing
                              + layer.items.length*nodeGroupYPadding*2
                              + layer.numNodeSpacings*nodeYSpacing;
        });


        // use computed sizes to compute positions of all layers, groups and nodes
        nodes.forEach(function(layer, layerIdx){
          var y = 0.5*(availableHeight-layer.totalHeight) + labelspace.top;
          layer.y = y;
          layer.items.forEach(function(group, groupIdx){

            group.x = labelspace.left+(availableWidth-nodeWidth)*layer.x;
            group.y = y;
            y += nodeGroupYPadding;

            group.items.forEach(function(node, nodeIdx){
              node.x = group.x;
              node.y = y;
              y += node.size * yscale;
              node.height = y - node.y;
              y += nodeYSpacing;

              node.layerIdx = layerIdx;
              node.groupIdx = groupIdx;
              node.nodeIdx = nodeIdx;
              node.uniqueId = [layerIdx, groupIdx, nodeIdx].join("-");
 
              // convernt string colors and set a default color
              // todo: where should this go?
              if (node.color.length) {
                node.color = d3.hsl(node.color);
              }
              if (!node.color) node.color = d3.hsl("#aaa");
            });

            y -= nodeYSpacing;
            y += nodeGroupYPadding;
            group.height = y - group.y;
            
            y += nodeGroupYSpacing;

          });
          y -= nodeGroupYSpacing;
        });


        
        /*
        Compute all the path data for the flows.
        First make a deep copy of the flows data because
        algorithm is destructive
        */
        var flowsCopy = data.flows.map(function(f){
          var f2 = {magnitude: f.magnitude};
          f2.extraClasses = f.path.map(function(addr){return "passes-"+addr.join("-");}).join(" ");
          f2.path = f.path.map(function(addr){
            return addr.slice(0);
          });
          return f2;
        });

        while(true) {

          flowsCopy = flowsCopy.filter(function(d){return d.path.length > 1;});
          if (flowsCopy.length === 0) return;

          flowsCopy.sort(function(a,b){
            return   a.path[0][0]-b.path[0][0] 
                  || a.path[0][1]-b.path[0][1] 
                  || a.path[0][2]-b.path[0][2]
                  || a.path[1][0]-b.path[1][0] 
                  || a.path[1][1]-b.path[1][1] 
                  || a.path[1][2]-b.path[1][2];
          });

          var layerIdx = flowsCopy[0].path[0][0];
          flowsCopy.forEach(function(flow){

            if (flow.path[0][0] != layerIdx) return;
            var from = flow.path[0];
            var to = flow.path[1];
            var h = flow.magnitude*yscale;

            var source = nodes[from[0]].items[from[1]].items[from[2]];
            var target = nodes[to[0]].items[to[1]].items[to[2]];

            var sourceY0 = source.filledOutY || source.y;
            var sourceY1 = sourceY0 + h;
            source.filledOutY = sourceY1;
            var targetY0 = target.filledInY || target.y;
            var targetY1 = targetY0 + h;
            target.filledInY = targetY1;

            flowAreasData.push({
              area: [
                      {x: source.x+nodeWidth, y0: sourceY0, y1: sourceY1},
                      {x: source.x+nodeWidth+flowStartWidth, y0: sourceY0, y1: sourceY1},
                      {x: target.x-flowStartWidth, y0: targetY0, y1: targetY1},
                      {x: target.x, y0: targetY0, y1: targetY1},
                    ],
              class: ["flow", flow.extraClasses].join(" ")
              });

            flow.path.shift();
          });
        }        

      })(); // end of data preparation


      // Create all svg elements: layers, groups, nodes and flows.
      var nodeLayers = parent.selectAll(".node-layers")
                            .data(prop("nodes"));

      // layer label positioning functions
      layerLabelx = function(d){return labelspace.left+d.x*(availableWidth-nodeWidth)+0.5*nodeWidth;};
      layerLabely = function(d){return 0.5*labelspace.top;};
      nodeLayers.enter()
                  .append("g").classed("node-layer",true)
                  .append("text")
                    .attr("class", "layer-label")
                    .attr("text-anchor","middle")
                    .attr("dx",0)
                    .attr("dy",0);

      nodeLayers.selectAll("text")
                    .attr("x", layerLabelx)
                    .attr("y", layerLabely)
                    .text(prop("title")).call(linebreak);

      nodeLayers.exit().remove();

      var nodeGroups = nodeLayers.selectAll("g.node-group").data(prop("items"));
      var enteringNodeGroups = nodeGroups.enter().append("g").classed("node-group", true);

      enteringNodeGroups.append("rect").classed("node-group", true);
      var enteringNodeGroupsG = enteringNodeGroups.append("g").attr("class","node-group-label");

      enteringNodeGroupsG.append("path");
      enteringNodeGroupsG.append("text");

      nodeGroups.selectAll("g.node-group > rect")
            .attr("x", prop("x"))
            .attr("y", prop("y"))
            .attr("width", nodeWidth)
            .attr("height", prop("height"));

      nodeGroups.selectAll("g.node-group > g")
        .style("display",function(d){return d.label ? "" : "none";});

      // node group label position functions
      nodeGroupLabelx = function(d){return d.x+0.5*nodeWidth+0.5*d.label*nodeWidth;};
      nodeGroupLabely = function(d){return d.y + 0.5*d.height;};
      nodeGroups.selectAll("g.node-group > g > path")
        .attr("d", function(d){
          return d3.svg.line()([
            [nodeGroupLabelx(d)+groupLabelDistance*d.label ,d.y+nodeGroupYPadding],
            [nodeGroupLabelx(d)+groupLabelDistance*d.label ,d.y+d.height-nodeGroupYPadding]
            ]);});

      nodeGroups.selectAll("g.node-group > g > text")
        .attr("text-anchor",function(d) {return d.label == -1 ? "end" : "start";})
        .attr("dx",function(d){return d.label*(groupLabelDistance*2);})
        .attr("dy","0.3em")
        .attr("x", nodeGroupLabelx)
        .attr("y", nodeGroupLabely)
        .text(prop("title")).call(linebreak);


      nodeGroups.exit().remove();

      var flowElements = parent.selectAll("path.flow").data(flowAreasData);
      flowElements.enter().append("path").attr("class", prop("class"));

      flowElements  
        .datum(prop("area"))
        .attr("d", 
          d3.svg.area()
            .x(prop("x"))
            .y0(prop("y0"))
            .y1(prop("y1"))
            .interpolate("basis"));
      flowElements.exit().remove();

      
      function activateNode(d){
        var node_id = d.uniqueId;
        var theflows, thenode;

        if (currentlyActive) {
          
          if (onNodeDeselected) onNodeDeselected(currentlyActive.d);

          theflows = parent.selectAll(".passes-"+currentlyActive.id);
          thenode = parent.selectAll(".node-"+currentlyActive.id);

          theflows
            .style("fill", null)
            .style("fill-opacity", null);


          if (currentlyActive.id == node_id) {
            currentlyActive = selectedNodeAddress = null;
            return;
          }
        }


        theflows = parent.selectAll(".passes-"+node_id);
        thenode = parent.selectAll(".node-"+node_id);

        theflows.transition()
          .style("fill", d.color)
          .style("fill-opacity", 1.0); 

        thenode.style("fill", d.color);
        currentlyActive = {"id": node_id, "d": d};
        selectedNodeAddress = node_id.split("-").map(function(d){return parseInt(d);});
        if (onNodeSelected) onNodeSelected(d);        
      }

      function mouseoverNode(d) {
        
        if (currentlyActive && currentlyActive.id == d.uniqueId) {
          return;
        }
        d3.select(this).style("fill", d.color.brighter());
      }

      function mouseoutNode(d) {
        if (currentlyActive && currentlyActive.id == d.uniqueId) {
          return;
        }
        d3.select(this).style("fill", d.color);
      }

      var nodeElements = nodeGroups.selectAll("rect.node").data(prop("items"));
      nodeElements.enter().append("rect").attr("class", function(d){return "node node-"+d.uniqueId;});
      nodeElements
        .attr("x", prop("x"))
        .attr("y", prop("y"))
        .attr("width", nodeWidth)
        .attr("height",prop("height"))
        .style("fill", function(d){return d.color;})
        .on("mouseover", mouseoverNode)
        .on("mouseout", mouseoutNode)
        .on("click", activateNode);
      nodeElements.exit().remove();
      
      if (selectedNodeAddress) {
        var node = data.nodes[selectedNodeAddress[0]]
                          .items[selectedNodeAddress[1]]
                          .items[selectedNodeAddress[2]];
        activateNode(node);
      }        
    }); // selection.each()
  }
 



  chart.width = function(_) {
    if (!arguments.length) return width;
    else width = +_;
    return chart;
  };
  chart.height = function(_) {
    if (!arguments.length) return height;
    else height = +_;
    return chart;
  };    
  chart.onNodeSelected = function(_) {
    if (!arguments.length) return onNodeSelected;
    else onNodeSelected = _;
    return chart;
  };   
  chart.onNodeDeselected = function(_) {
    if (!arguments.length) return onNodeDeselected;
    else onNodeDeselected = _;
    return chart;
  };
  chart.selectedNodeAddress = function(_) {
    if (!arguments.length) return selectedNodeAddress;
    else selectedNodeAddress = _;
    return chart;
  };
  chart.labelSpaceLeft = function(_) {
    if (!arguments.length) return labelspace.left;
    else labelspace.left = _;
    return chart;
  };
  chart.labelSpaceRight = function(_) {
    if (!arguments.length) return labelspace.right;
    else labelspace.right = _;
    return chart;
  };

  return chart;
};

 