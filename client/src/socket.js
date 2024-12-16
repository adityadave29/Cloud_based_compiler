import { io } from 'socket.io-client'

const socket = io('http://10.1.47.162:9000')

export default socket