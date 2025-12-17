import NextAuth from "next-auth"
import { authOptions } from "../../../lib/config/auth"

export { authOptions }

export default NextAuth(authOptions)
