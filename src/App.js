import './App.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Home from './pages/Home';
import EditorPage from './pages/EditorPage';

function App() {
    return (
        <>
            <div>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        success: {
                            style: {
                                background: 'linear-gradient(45deg, #240046, #3c096c)',
                                color: '#c77dff',
                                border: '1px solid rgba(157, 78, 221, 0.5)',
                            },
                        },
                        error: {
                            style: {
                                background: 'linear-gradient(45deg, #460246, #6c0936)',
                                color: '#ff7ddd',
                                border: '1px solid rgba(221, 78, 157, 0.5)',
                            },
                        },
                    }}
                ></Toaster>
            </div>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Home />}></Route>
                    <Route
                        path="/editor/:roomId"
                        element={<EditorPage />}
                    ></Route>
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;
