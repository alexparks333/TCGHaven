import dynamic from 'next/dynamic'

const Page = dynamic(() => import('@/components/pages/SignupPage'), { ssr: false })
export default Page
