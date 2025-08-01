import React, { useState } from 'react';
import { v4 as uuidV4 } from 'uuid';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const Home = () => {
    const navigate = useNavigate();

    const [roomId, setRoomId] = useState('');
    const [username, setUsername] = useState('');
    const createNewRoom = (e) => {
        e.preventDefault();
        const id = uuidV4();
        setRoomId(id);
        toast.success('Created a new room!');
    };

    const joinRoom = () => {
        if (!roomId || !username) {
            toast.error('Room ID & username required!');
            return;
        }

        // Redirect
        navigate(`/editor/${roomId}`, {
            state: {
                username,
            },
        });
    };

    const handleInputEnter = (e) => {
        if (e.code === 'Enter') {
            joinRoom();
        }
    };
    return (
        <div className="homePageWrapper">
            <div className="formWrapper">
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h1 style={{ 
                        background: 'linear-gradient(45deg, #9d4edd, #c77dff)', 
                        WebkitBackgroundClip: 'text', 
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontSize: '2.5rem',
                        margin: '0',
                        textShadow: '0 0 20px rgba(157, 78, 221, 0.3)'
                    }}>
                        Coco's Playground
                    </h1>
                    <p style={{ color: '#b19cd9', margin: '10px 0 0 0', fontSize: '1.1rem' }}>
                        Collaborative Code Editor
                    </p>
                </div>
                <h4 className="mainLabel">Enter Room ID</h4>
                <div className="inputGroup">
                    <input
                        type="text"
                        className="inputBox"
                        placeholder="ROOM ID"
                        onChange={(e) => setRoomId(e.target.value)}
                        value={roomId}
                        onKeyUp={handleInputEnter}
                    />
                    <input
                        type="text"
                        className="inputBox"
                        placeholder="USERNAME"
                        onChange={(e) => setUsername(e.target.value)}
                        value={username}
                        onKeyUp={handleInputEnter}
                    />
                    <button className="btn joinBtn" onClick={joinRoom}>
                        Join
                    </button>
                    <span className="createInfo">
                        Don't have an invitation? Create your own &nbsp;
                        <button
                            onClick={createNewRoom}
                            className="createNewBtn"
                            style={{ background: 'none', border: 'none', color: '#c77dff', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                        >
                            new room
                        </button>
                    </span>
                </div>
            </div>
            <footer>
                <h4>
                    Made by &nbsp;
                    <a href="https://github.com/girisha1908">girisha1908</a>
                </h4>
            </footer>
        </div>
    );
};

export default Home;
