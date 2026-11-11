// Shared by the React client and the Node server (CommonJS so server can require it).
// `run` is executed with `bash -c` inside /workspace of the room's sandbox container.
const LANGUAGES = {
    python: {
        label: 'Python 3',
        file: 'main.py',
        monaco: 'python',
        run: 'python3 main.py',
        template: 'print("Hello from Coco\'s Playground!")\n',
    },
    javascript: {
        label: 'JavaScript (Node)',
        file: 'main.js',
        monaco: 'javascript',
        run: 'node main.js',
        template: 'console.log("Hello from Coco\'s Playground!");\n',
    },
    c: {
        label: 'C (gcc)',
        file: 'main.c',
        monaco: 'c',
        run: 'gcc -O2 -o /tmp/main main.c && /tmp/main',
        template: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from Coco\'s Playground!\n");\n    return 0;\n}\n',
    },
    cpp: {
        label: 'C++ (g++)',
        file: 'main.cpp',
        monaco: 'cpp',
        run: 'g++ -O2 -o /tmp/main main.cpp && /tmp/main',
        template: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from Coco\'s Playground!" << std::endl;\n    return 0;\n}\n',
    },
    java: {
        label: 'Java',
        file: 'Main.java',
        monaco: 'java',
        run: 'javac -d /tmp/java Main.java && java -cp /tmp/java Main',
        template: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Coco\'s Playground!");\n    }\n}\n',
    },
    go: {
        label: 'Go',
        file: 'main.go',
        monaco: 'go',
        run: 'go run main.go',
        template: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Coco\'s Playground!")\n}\n',
    },
    bash: {
        label: 'Bash',
        file: 'main.sh',
        monaco: 'shell',
        run: 'bash main.sh',
        template: 'echo "Hello from Coco\'s Playground!"\n',
    },
};

const DEFAULT_LANGUAGE = 'python';

module.exports = { LANGUAGES, DEFAULT_LANGUAGE };
