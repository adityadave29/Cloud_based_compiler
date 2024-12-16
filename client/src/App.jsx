import { useCallback, useEffect, useState } from "react";
import Terminal from "./components/terminal";
import "./App.css";
import FileTree from "./components/tree";
import socket from "./socket";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/ext-language_tools";


function App() {
  const [fileTree, setFileTree] = useState({})
  const [selectedFile, setSelectedFile] = useState("");
  const [code, setCode] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");

  const isSaved = selectedFileContent === code;

  const getFileTree = async () => {
    const response = await fetch("http://10.1.47.162:9000/files")
    const result = await response.json()
    setFileTree(result.tree)
  }

  useEffect(() => {
      getFileTree();
    }, []);

  const getFileContents = useCallback(async () => {
    if (!selectedFile) return;
    const response = await fetch(
      `http://10.1.47.162:9000/files/content?path=${selectedFile}`
    );
    const result = await response.json();
    setSelectedFileContent(result.content);
  }, [selectedFile]);

  useEffect(() => {
    setCode(setSelectedFile );
  }, [setSelectedFile]);

  useEffect(() => {
    if (selectedFile) getFileContents();
  }, [getFileContents, selectedFile]);


  useEffect(() => {
    socket.on("file:refresh", getFileTree);
    return () => {
      socket.off("file:refresh", getFileTree);
    };
  }, []);

  useEffect(() => {
    if (code && !isSaved) {
      const timer = setTimeout(() => {
        socket.emit("file:change", {
          path: selectedFile,
          content: code,
        });
      }, 5 * 1000);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [code, selectedFile, isSaved]);

  useEffect(() => {
    setCode("");
  },[selectedFile]);

  return (
    <div className="playground-container">
      <div className="editor-container">
        <div className="files">
          <FileTree 
           onSelect={(path) => {
            setSelectedFile(path);
          }}
          tree={fileTree} />
        </div>
        <div className="editor">
        {selectedFile && (
            <p>
              {selectedFile.replaceAll("/"," > ")} {isSaved ? "saved" : "unsaved"}
            </p>
          )}
          <AceEditor 
          value ={code}
          onChange={e => setCode(e)}
          />
        </div>
      </div>
        <div className="terminal-container"><Terminal /></div>
    </div>
  )
}

export default App