# Coco's Playground

🚀 **[Live Demo](https://cocos-playground.onrender.com)** | 🔗 **[GitHub Repository](https://github.com/Girisha1908/Collaborative-Code-editor)**

A real-time collaborative code editor designed for seamless pair programming, code reviews, and educational coding sessions.

## Problem Statement

• **Remote Collaboration Barriers**: Developers, students, and coding teams face significant challenges when attempting to collaborate on code in real-time, especially in remote work environments. 

•Many existing collaborative coding platforms are either too complex for casual use, require expensive subscriptions, or demand extensive technical setup that creates barriers for beginners, students, and small teams. This lack of accessible, user-friendly solutions prevents effective pair programming, code reviews, technical interviews, and educational coding sessions from happening seamlessly.


## Technical Stack

### Frontend
- **React 17.0.2**: Core JavaScript library for building the user interface with component-based architecture
- **React Router DOM 6.2.1**: Client-side routing for seamless navigation between pages
- **CodeMirror 5.65.2**: Powerful code editor component with syntax highlighting and real-time collaboration features
- **React Hot Toast 2.2.0**: Toast notification system for user feedback and status updates
- **React Avatar 4.0.0**: Dynamic avatar generation for user identification in collaborative sessions
- **Socket.IO Client 4.4.1**: Real-time bidirectional communication between frontend and backend
- **UUID 8.3.2**: Unique identifier generation for rooms and user sessions

### Backend
- **Node.js**: JavaScript runtime environment for server-side execution
- **Express.js 4.17.3**: Minimal web application framework for building RESTful APIs and handling HTTP requests
- **Socket.IO 4.4.1**: Real-time WebSocket communication for collaborative editing and user presence
- **CORS**: Cross-Origin Resource Sharing middleware for handling frontend-backend communication

### Database
- **In-Memory Storage**: Currently uses server-side memory for storing active room data and user sessions (suitable for development and small-scale deployment)
- **Session Management**: Real-time user presence and code synchronization handled through Socket.IO connections

### APIs
- **No External APIs**: The application is designed to be self-contained without dependencies on third-party services, ensuring privacy and reducing external points of failure. All functionality is handled internally through the Express server and Socket.IO connections.

## Project Summary

### 📋 **Project Objectives and Achievements**

**Primary Objective**: Create an accessible, real-time collaborative code editor that eliminates barriers to pair programming and remote coding collaboration.

**Key Achievements:**
- ✅ **Real-time Synchronization**: Successfully implemented instant code synchronization across multiple users using Socket.IO, achieving sub-second latency for collaborative editing
- ✅ **User-friendly Interface**: Developed a clean, space-themed UI that prioritizes functionality over complexity, making the platform accessible to beginners and professionals alike  
- ✅ **Zero-setup Collaboration**: Eliminated complex authentication and setup procedures - users can start collaborating immediately with just a Room ID and username
- ✅ **Cross-platform Compatibility**: Built a responsive web application that works seamlessly across different devices and browsers without requiring installations
