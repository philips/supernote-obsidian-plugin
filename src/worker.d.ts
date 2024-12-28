declare module 'myworker.worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}