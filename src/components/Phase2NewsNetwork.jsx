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
    stabilization: { iterations: 150 },
    barnesHut: {
      gravitationalConstant: -4200,
      springLength: 140,
      springConstant: 0.03,
      damping: 0.16
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
      strokeWidth: 3,
      strokeColor: "rgba(255, 250, 242, 0.82)"
    },
    scaling: {
      min: 12,
      max: 40
    }
  },
  edges: {
    smooth: {
      enabled: true,
      type: "continuous",
      roundness: 0.32
    },
    color: {
      color: "rgba(92, 66, 48, 0.24)",
      hover: "rgba(92, 66, 48, 0.5)",
      highlight: "rgba(34, 74, 105, 0.56)"
    }
  },
  groups: {
    entity: {
      color: {
        background: "#ecd0bb",
        border: "#9a5d3d",
        highlight: {
          background: "#f4dfd0",
          border: "#7d4a31"
        }
      }
    }
  }
};

function Phase2NewsNetwork({ graph }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);

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
      networkRef.current = new Network(containerRef.current, data, networkOptions);
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

  useEffect(() => () => {
    networkRef.current?.destroy();
    networkRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="news-network-canvas"
      aria-label="日別ニュースのエンティティ共起ネットワーク"
    />
  );
}

export default Phase2NewsNetwork;
