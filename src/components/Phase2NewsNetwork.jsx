import { useEffect, useRef } from "react";
import { DataSet, Network } from "vis-network/standalone";

function instantiateDataSet(items) {
  return new DataSet(items);
}

const networkOptions = {
  autoResize: true,
  interaction: {
    hover: true,
    navigationButtons: false
  },
  physics: {
    stabilization: { iterations: 180 },
    barnesHut: {
      gravitationalConstant: -3600,
      springLength: 170,
      springConstant: 0.025
    }
  },
  layout: {
    improvedLayout: true
  },
  nodes: {
    shape: "dot",
    borderWidth: 2,
    font: {
      size: 16,
      face: "Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif",
      color: "#20201e",
      strokeWidth: 4,
      strokeColor: "rgba(255, 250, 242, 0.9)"
    },
    scaling: {
      min: 14,
      max: 38
    }
  },
  edges: {
    smooth: {
      enabled: true,
      type: "continuous",
      roundness: 0.24
    },
    color: {
      color: "rgba(163, 66, 36, 0.34)",
      hover: "rgba(163, 66, 36, 0.7)",
      highlight: "rgba(34, 74, 105, 0.72)"
    }
  },
  groups: {
    date: {
      color: {
        background: "#193951",
        border: "#102738",
        highlight: {
          background: "#224a69",
          border: "#102738"
        }
      },
      font: {
        color: "#f4f8fb",
        size: 20
      }
    },
    entity: {
      color: {
        background: "#f0c9ae",
        border: "#a34224",
        highlight: {
          background: "#f6dcc8",
          border: "#8c361b"
        }
      }
    }
  }
};

function Phase2NewsNetwork({ graph, selectedDate, onDateChange }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const changeHandlerRef = useRef(onDateChange);

  useEffect(() => {
    changeHandlerRef.current = onDateChange;
  }, [onDateChange]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    if (!graph) {
      if (networkRef.current) {
        networkRef.current.setData({
          nodes: instantiateDataSet([]),
          edges: instantiateDataSet([])
        });
      }
      return;
    }

    const data = {
      nodes: instantiateDataSet(graph.nodes),
      edges: instantiateDataSet(graph.edges)
    };

    if (!networkRef.current) {
      const network = new Network(containerRef.current, data, networkOptions);
      network.on("click", (params) => {
        const nodeId = params.nodes?.[0];
        if (!nodeId || !String(nodeId).startsWith("date:")) {
          return;
        }
        const nextDate = String(nodeId).replace("date:", "");
        changeHandlerRef.current?.(nextDate);
      });
      networkRef.current = network;
    } else {
      networkRef.current.setData(data);
    }

    networkRef.current.fit({
      animation: {
        duration: 500,
        easingFunction: "easeInOutQuad"
      }
    });
  }, [graph]);

  useEffect(() => {
    if (!networkRef.current || !graph) {
      return;
    }

    const selectedNodeId = `date:${selectedDate}`;
    const availableIds = new Set(graph.nodes.map((node) => String(node.id)));
    if (availableIds.has(selectedNodeId)) {
      networkRef.current.selectNodes([selectedNodeId]);
      networkRef.current.focus(selectedNodeId, {
        scale: 1,
        animation: {
          duration: 350,
          easingFunction: "easeInOutQuad"
        }
      });
    } else {
      networkRef.current.unselectAll();
    }
  }, [graph, selectedDate]);

  useEffect(() => () => {
    networkRef.current?.destroy();
    networkRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="news-network-canvas"
      aria-label="日別ニュースの注目キーワードグラフ"
    />
  );
}

export default Phase2NewsNetwork;
